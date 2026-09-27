const db = require('./db');
const { getIndicators } = require('./indicators');
const { isMarketOpenFor } = require('./marketHours');

// --- Thresholds — must match strategies.js -------------------------------
const MAX_ENTRY_DISTANCE_PCT = 3.0;   // entry >3% from current price = too far
const MISSED_MOVE_PCT = 40;           // price >40% of the way to target = too late

// Checks APPROVED/OPEN trades — these count toward real performance stats
async function checkOpenTrades() {
  const openTrades = db.prepare("SELECT * FROM trades WHERE status = 'approved' OR status = 'open'").all();
  const results = [];

  for (const trade of openTrades) {
    if (!isMarketOpenFor(trade.symbol)) continue;

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
        db.prepare("UPDATE trades SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(newStatus, trade.id);
        results.push({ id: trade.id, name: trade.name, ratio: trade.ratio, outcome: newStatus, currentPrice });
      }
    } catch (err) {
      console.log(`Failed checking ${trade.name}: ${err.message}`);
    }
  }

  return results;
}

// Checks PENDING (unapproved) trades — these do NOT count toward real
// performance stats. We record what would have happened so nothing silently
// vanishes without you knowing.
async function checkPendingOutcomes() {
  const pending = db.prepare("SELECT * FROM trades WHERE status = 'pending_approval'").all();
  const results = [];

  for (const trade of pending) {
    if (!isMarketOpenFor(trade.symbol)) continue;

    try {
      const ind = await getIndicators(trade.symbol);
      const currentPrice = ind.price;

      let newStatus = null;
      if (trade.direction === 'BUY') {
        if (currentPrice >= trade.take_profit) newStatus = 'missed_tp';
        else if (currentPrice <= trade.stop_loss) newStatus = 'missed_sl';
      } else if (trade.direction === 'SELL') {
        if (currentPrice <= trade.take_profit) newStatus = 'missed_tp';
        else if (currentPrice >= trade.stop_loss) newStatus = 'missed_sl';
      }

      if (newStatus) {
        db.prepare("UPDATE trades SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(newStatus, trade.id);
        results.push({ id: trade.id, name: trade.name, ratio: trade.ratio, outcome: newStatus, currentPrice });
      }
    } catch (err) {
      console.log(`Failed checking pending ${trade.name}: ${err.message}`);
    }
  }

  return results;
}

// --- Expire stale pending trades -----------------------------------------
// A pending trade becomes stale when it can no longer be acted on:
//   1. Price hit the stop             → 'stopped_out'
//   2. Price already blew past target → 'blown_through'
//   3. Price is ≥MISSED_MOVE_PCT of the way to target → 'missed_move_XXpct'
//   4. Price moved past entry but not far enough to hit #3 → 'entry_passed'
//   5. Entry is >MAX_ENTRY_DISTANCE_PCT away from current price → 'too_far'
//
// This runs BEFORE checkPendingOutcomes on every scan, so the two never
// fight. Stale trades are marked 'expired' — distinct from 'missed_tp/sl',
// which are reserved for trades that actually reached their level.
async function expireStalePending() {
  const pending = db.prepare("SELECT * FROM trades WHERE status = 'pending_approval'").all();
  const expired = [];

  for (const trade of pending) {
    if (!isMarketOpenFor(trade.symbol)) continue;

    try {
      const ind = await getIndicators(trade.symbol);
      const currentPrice = Number(ind.price);
      const entry = Number(trade.entry);
      const sl = Number(trade.stop_loss);
      const tp = Number(trade.take_profit);
      if (!currentPrice || !entry || !sl || !tp) continue;

      const isBuy = trade.direction === 'BUY';
      const reward = Math.abs(tp - entry);

      const distancePct = Math.abs(entry - currentPrice) / currentPrice * 100;
      const progressPct = isBuy
        ? (currentPrice - entry) / reward * 100
        : (entry - currentPrice) / reward * 100;

      const slHit = isBuy ? currentPrice <= sl : currentPrice >= sl;
      const blownThrough = isBuy ? currentPrice >= tp : currentPrice <= tp;
      const entryPassed = isBuy ? currentPrice > entry : currentPrice < entry;

      let reason = null;

      if (slHit) reason = 'stopped_out';
      else if (blownThrough) reason = 'blown_through';
      else if (entryPassed && progressPct >= MISSED_MOVE_PCT) {
        reason = `missed_move_${Math.round(progressPct)}pct`;
      }
      else if (entryPassed) reason = 'entry_passed';
      else if (distancePct > MAX_ENTRY_DISTANCE_PCT) reason = 'too_far';

      if (reason) {
        db.prepare(
          "UPDATE trades SET status = 'expired', closed_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(trade.id);

        expired.push({
          id: trade.id,
          name: trade.name,
          symbol: trade.symbol,
          mode: trade.mode,
          direction: trade.direction,
          entry,
          price: currentPrice,
          reason,
          distancePct: Math.round(distancePct * 100) / 100,
          progressPct: Math.round(progressPct),
        });
      }
    } catch (err) {
      console.log(`expireStalePending: ${trade.name} — ${err.message}`);
    }
  }

  return expired;
}

// Only counts hit_tp/hit_sl — missed_* and expired are excluded on purpose,
// since those were never actually taken and shouldn't affect the real,
// acted-upon track record.
function getPerformanceStats() {
  const closed = db.prepare("SELECT * FROM trades WHERE status IN ('hit_tp', 'hit_sl')").all();

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

module.exports = {
  checkOpenTrades,
  checkPendingOutcomes,
  expireStalePending,
  getPerformanceStats,
};
