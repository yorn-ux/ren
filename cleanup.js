const db = require('./db');
const { getIndicators } = require('./indicators');
const { isMarketOpenFor } = require('./marketHours');

const REJECTED_RETENTION_HOURS = 24;

function cleanupRejectedTrades() {
  const cutoff = new Date(Date.now() - REJECTED_RETENTION_HOURS * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const result = db.prepare(
    `DELETE FROM trades WHERE status = 'rejected' AND closed_at IS NOT NULL AND closed_at < ?`
  ).run(cutoff);

  return result.changes;
}

// Only removes pending trades where price is STILL inside the valid
// entry-to-target range (i.e., genuinely stale/abandoned, entry never
// filled, nothing resolved) — NOT trades that already hit missed_tp/missed_sl,
// since those are handled and recorded by checkPendingOutcomes first.
async function cleanupStalePendingTrades() {
  const pending = db.prepare(`SELECT * FROM trades WHERE status = 'pending_approval'`).all();
  let deletedCount = 0;
  const deletedNames = [];

  for (const trade of pending) {
    if (!isMarketOpenFor(trade.symbol)) continue;

    try {
      const ind = await getIndicators(trade.symbol);
      const currentPrice = ind.price;
      const stopLoss = Number(trade.stop_loss);
      const takeProfit = Number(trade.take_profit);
      const isBuy = trade.direction === 'BUY';

      let isStale = false;
      if (isBuy) {
        isStale = currentPrice < stopLoss || currentPrice > takeProfit;
      } else {
        isStale = currentPrice > stopLoss || currentPrice < takeProfit;
      }

      if (isStale) {
        db.prepare('DELETE FROM trades WHERE id = ?').run(trade.id);
        deletedCount++;
        deletedNames.push(trade.name);
      }
    } catch (err) {
      console.log(`Staleness check failed for ${trade.name}: ${err.message}`);
    }
  }

  return { deletedCount, deletedNames };
}

module.exports = { cleanupRejectedTrades, cleanupStalePendingTrades };
