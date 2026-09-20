require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const watchlist = require('./watchlist');
const { getTradeRecommendation } = require('./brain');
const { getActiveMode, setActiveMode, registerMode } = require('./modes');
const { getPerformanceStats } = require('./outcomes');
const { approveLatest, rejectLatest } = require('./approvals');
const { runScan } = require('./scheduler');
const { getMarketStatus } = require('./market_hours');
const portfolio = require('./portfolio');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Trade status groups -------------------------------------------------
const OPEN_STATUSES = ['open', 'approved', 'pending_approval'];
const CLOSED_STATUSES = ['hit_tp', 'hit_sl'];
// 'expired' and 'rejected' are terminal but not P&L-affecting

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Schema helpers ------------------------------------------------------
let TRADE_COLUMNS = null;

function tradeColumns() {
  if (TRADE_COLUMNS) return TRADE_COLUMNS;
  try {
    const cols = db.prepare('PRAGMA table_info(trades)').all();
    TRADE_COLUMNS = new Set(cols.map(c => c.name));
  } catch (err) {
    console.error('Could not read trades schema:', err.message);
    TRADE_COLUMNS = new Set();
  }
  return TRADE_COLUMNS;
}

function col(row, name, fallback = null) {
  return tradeColumns().has(name) ? row[name] : fallback;
}

// --- P&L math ------------------------------------------------------------
function realizedPnlFor(t) {
  const entry = Number(t.entry);
  const tp = Number(t.take_profit);
  const sl = Number(t.stop_loss);
  if (!entry || !tp || !sl) return 0;

  const isBuy = t.direction === 'BUY' || (t.direction == null && tp > sl);
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);

  if (t.status === 'hit_tp') return isBuy ? reward : -reward;
  if (t.status === 'hit_sl') return isBuy ? -risk : risk;
  return 0;
}

// --- Watchlist & Mode ----------------------------------------------------
app.get('/api/watchlist', (req, res) => {
  res.json(watchlist);
});

app.get('/api/mode', (req, res) => {
  const mode = getActiveMode();
  res.json(mode || { name: 'pulse' });
});

app.post('/api/mode/:name', (req, res) => {
  const { name } = req.params;
  if (!portfolio.VALID_MODES.includes(name.toLowerCase())) {
    return res.status(400).json({ error: `Unknown mode: ${name}` });
  }
  setActiveMode(name);
  res.json({ success: true, mode: name });
});

// --- Market hours --------------------------------------------------------
app.get('/api/market-status/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const name = req.query.name || symbol;
    res.json(getMarketStatus(symbol, name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Portfolio config (starting balance + currency, per mode) ------------
app.get('/api/portfolios', (req, res) => {
  try {
    res.json(portfolio.listPortfolios());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/portfolios/:mode', (req, res) => {
  try {
    res.json(portfolio.getPortfolio(req.params.mode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/portfolios/:mode', (req, res) => {
  try {
    const { startingBalance, currency } = req.body;
    const result = portfolio.setPortfolio(req.params.mode, startingBalance, currency);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Stats ---------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  try {
    const mode = (req.query.mode || 'pulse').toLowerCase();
    const stats = getPerformanceStats(mode);
    res.json(stats);
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Trades log (filterable by mode and/or status) -----------------------
// Examples:
//   /api/trades                                 → last 100 across all modes
//   /api/trades?mode=pulse                      → last 100 for pulse
//   /api/trades?mode=pulse&status=pending_approval
//   /api/trades?status=hit_tp,hit_sl            → closed trades only
//   /api/trades?mode=pulse&status=expired       → expired only
app.get('/api/trades', (req, res) => {
  try {
    const mode = req.query.mode ? String(req.query.mode).toLowerCase() : null;
    const statusParam = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const clauses = [];
    const params = [];

    if (mode) {
      clauses.push('mode = ?');
      params.push(mode);
    }

    if (statusParam) {
      const statuses = statusParam
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      if (statuses.length) {
        clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM trades ${where} ORDER BY id DESC LIMIT ?`;
    params.push(limit);

    const trades = db.prepare(sql).all(...params);
    res.json(trades);
  } catch (err) {
    console.error('Error fetching trades:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Portfolio per mode --------------------------------------------------
app.get('/api/portfolio', (req, res) => {
  try {
    const mode = (req.query.mode || 'pulse').toLowerCase();
    const cfg = portfolio.getPortfolio(mode);
    const startingBalance = Number(cfg.starting_balance) || 0;
    const currency = cfg.currency || 'USD';

    const openPlaceholders = OPEN_STATUSES.map(() => '?').join(',');
    const closedPlaceholders = CLOSED_STATUSES.map(() => '?').join(',');

    const openTrades = db.prepare(
      `SELECT * FROM trades WHERE status IN (${openPlaceholders}) AND mode = ? ORDER BY id DESC`
    ).all(...OPEN_STATUSES, mode);

    // Oldest → newest so the curve plots left-to-right correctly
    const closedTrades = db.prepare(
      `SELECT * FROM trades WHERE status IN (${closedPlaceholders}) AND mode = ? ORDER BY id ASC`
    ).all(...CLOSED_STATUSES, mode);

    // Realized P&L — derived from entry/stop/target
    let running = startingBalance;
    const curve = [{ value: running, t: null }];
    const closedForDisplay = [];

    for (const t of closedTrades) {
      const pnl = realizedPnlFor(t);
      running += pnl;
      curve.push({ value: running, t: t.closed_at || t.created_at });

      closedForDisplay.push({
        id: t.id,
        name: t.name,
        symbol: t.symbol,
        direction: t.direction,
        entry: t.entry,
        exit: t.status === 'hit_tp' ? t.take_profit : t.stop_loss,
        ratio: t.ratio,
        status: t.status,
        pnl,
        closedAt: t.closed_at,
      });
    }

    const realizedPnl = running - startingBalance;

    // Unrealized P&L — 0 until you wire up live pricing.
    const unrealizedPnl = openTrades.reduce(
      (sum, t) => sum + (Number(col(t, 'unrealized_pnl', 0)) || 0),
      0
    );

    const balance = startingBalance + realizedPnl;
    const equity = balance + unrealizedPnl;
    const pnl = realizedPnl + unrealizedPnl;

    const positions = openTrades.map(t => ({
      id: t.id,
      name: t.name,
      symbol: t.symbol,
      direction: t.direction,
      size: col(t, 'size', null),
      entry: t.entry,
      stopLoss: t.stop_loss,
      takeProfit: t.take_profit,
      ratio: t.ratio,
      status: t.status,
      pnl: Number(col(t, 'unrealized_pnl', 0)) || 0,
    }));

    res.json({
      mode,
      currency,
      startingBalance,
      balance,
      equity,
      realizedPnl,
      unrealizedPnl,
      pnl,
      openCount: openTrades.length,
      closedCount: closedTrades.length,
      positions,
      closed: closedForDisplay.slice(-20).reverse(),
      curve,
    });
  } catch (err) {
    console.error('Error fetching portfolio:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Analyze -------------------------------------------------------------
async function handleAnalyze(req, res) {
  const symbol = req.params.symbol;
  const name = req.params.name || symbol;

  try {
    const result = await getTradeRecommendation(symbol, name, true);
    res.json(result);
  } catch (err) {
    console.error(`Error analyzing ${symbol}:`, err);
    res.status(500).json({
      hasSetup: false,
      error: err.message,
      reasoning: `Failed to analyze ${name}: ${err.message}`,
    });
  }
}

app.post('/api/analyze/:symbol/:name', handleAnalyze);
app.post('/api/analyze/:symbol', handleAnalyze);

// --- Approve / Reject ----------------------------------------------------
app.post('/api/trades/approve', (req, res) => {
  const { name, mode } = req.body;
  const result = approveLatest(name, mode);
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

app.post('/api/trades/reject', (req, res) => {
  const { name, mode } = req.body;
  const result = rejectLatest(name, mode);
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// --- Manual scan ---------------------------------------------------------
app.post('/api/scan', async (req, res) => {
  runScan().catch(err => console.error('Scan error:', err));
  res.json({ success: true, message: 'Watchlist scan initiated.' });
});

// --- SPA fallback --------------------------------------------------------
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Seed + start --------------------------------------------------------
['pulse', 'focus', 'grind'].forEach(m => registerMode(m));
portfolio.seedDefaults();

const server = app.listen(PORT, () => {
  console.log(`✔ REN Web Server running on http://localhost:${PORT}`);
  console.log(`✔ Portfolios seeded. Configure each via POST /api/portfolios/:mode`);
  console.log(`✔ Trade statuses — open: [${OPEN_STATUSES.join(', ')}] closed: [${CLOSED_STATUSES.join(', ')}]`);
});

module.exports = app;
