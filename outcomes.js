const db = require('./db');
const { getIndicators } = require('./indicators');

// --- Status helpers ------------------------------------------------------
// 'open' and 'approved' are both live (legacy 'approved' rows from earlier
// versions still get checked so nothing is stuck).
function getTradesToCheck() {
  return db.prepare(
    "SELECT * FROM trades WHERE status IN ('open', 'approved')"
  ).all();
}

// --- P&L math ------------------------------------------------------------
function computePnl(trade, newStatus) {
  const entry = Number(trade.entry);
  const tp = Number(trade.take_profit);
  const sl = Number(trade.stop_loss);
  if (!entry || !tp || !sl) return 0;

  const isBuy = trade.direction === 'BUY';
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);

  if (newStatus === 'hit_tp') return isBuy ? reward : -reward;
  if (newStatus === 'hit_sl') return isBuy ? -risk : risk;
  return 0;
}

// --- Column existence check (cached) -------------------------------------
let HAS_PNL_COLUMN = null;
function hasPnlColumn() {
  if (HAS_PNL_COLUMN !== null) return HAS_PNL_COLUMN;
  try {
    const cols = db.prepare('PRAGMA table_info(trades)').all();
    HAS_PNL_COLUMN = cols.some(c => c.name === 'pnl');
  } catch (err) {
    HAS_PNL_COLUMN = false;
  }
  return HAS_PNL_COLUMN;
}

// --- Check open trades against current price -----------------------------
async function checkOpenTrades() {
  const openTrades = getTradesToCheck();
  const results = [];

  for (const trade of openTrades) {
    try {
      const ind = await getIndicators(trade.symbol);
      const currentPrice = ind.price;

      let newStatus = null;

      if (trade.direction === 'BUY') {
        if (currentPrice >= trade.take_profit) newStatus = 'hit_tp';
        else if (currentPrice <= trade.stop_loss) newStatus = 'hit_sl';
      } else if (trade.direction === 'SELL') {
        if (currentPrice <= trade.take_profit) newStatus = 'hit_tp';
        else if (currentPrice >= trade.stop_loss) newStatus = 'hit_sl';
      }

      if (newStatus) {
        const pnl = computePnl(trade, newStatus);

        if (hasPnlColumn()) {
          db.prepare(`
            UPDATE trades
            SET status = ?, closed_at = CURRENT_TIMESTAMP, pnl = ?
            WHERE id = ?
          `).run(newStatus, pnl, trade.id);
        } else {
          db.prepare(`
            UPDATE trades
            SET status = ?, closed_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(newStatus, trade.id);
        }

        results.push({
          id: trade.id,
          name: trade.name,
          mode: trade.mode,
          ratio: trade.ratio,
          outcome: newStatus,
          pnl,
          currentPrice,
        });
      }
    } catch (err) {
      console.log(`Failed checking ${trade.name}: ${err.message}`);
    }
  }

  return results;
}

// --- Expire stale pending trades -----------------------------------------
// A pending trade is stale when price has reached/passed the entry level
// before you approved it. The setup window has closed — it never became live,
// so it should not sit in Pending forever.
//
// BUY: entry hit when price fell to or below entry (pullback was filled)
// SELL: entry hit when price rose to or above entry
//
// Tolerance: 0.1% of entry value to avoid flapping on tiny ticks.
async function expireStalePending() {
  const pending = db.prepare(
    "SELECT * FROM trades WHERE status = 'pending_approval'"
  ).all();

  const expired = [];

  for (const trade of pending) {
    try {
      const ind = await getIndicators(trade.symbol);
      const price = Number(ind.price);
      const entry = Number(trade.entry);
      if (!price || !entry) continue;

      const tolerance = Math.abs(entry) * 0.001;
      const isBuy = trade.direction === 'BUY';

      const entryHit = isBuy
        ? price <= entry + tolerance
        : price >= entry - tolerance;

      if (entryHit) {
        db.prepare(`
          UPDATE trades
          SET status = 'expired', closed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(trade.id);

        expired.push({
          id: trade.id,
          name: trade.name,
          symbol: trade.symbol,
          mode: trade.mode,
          direction: trade.direction,
          entry: trade.entry,
          price,
        });
      }
    } catch (err) {
      console.log(`expireStalePending: ${trade.name} — ${err.message}`);
    }
  }

  return expired;
}

// --- Performance stats, optionally scoped to a mode ----------------------
function getPerformanceStats(mode) {
  const m = mode ? String(mode).toLowerCase() : null;

  const closed = m
    ? db.prepare(
        "SELECT * FROM trades WHERE status IN ('hit_tp', 'hit_sl') AND mode = ?"
      ).all(m)
    : db.prepare(
        "SELECT * FROM trades WHERE status IN ('hit_tp', 'hit_sl')"
      ).all();

  const stats = { '1:2': { wins: 0, losses: 0 }, '1:3': { wins: 0, losses: 0 } };

  for (const trade of closed) {
    if (!stats[trade.ratio]) continue;
    if (trade.status === 'hit_tp') stats[trade.ratio].wins++;
    else stats[trade.ratio].losses++;
  }

  const summary = {};
  for (const ratio of ['1:2', '1:3']) {
    const total = stats[ratio].wins + stats[ratio].losses;
    summary[ratio] = {
      wins: stats[ratio].wins,
      losses: stats[ratio].losses,
      total,
      winRate: total > 0 ? ((stats[ratio].wins / total) * 100).toFixed(1) + '%' : 'no data yet',
    };
  }

  return summary;
}

module.exports = { checkOpenTrades, getPerformanceStats, expireStalePending };
