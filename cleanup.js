const db = require('./db');
const { getIndicators } = require('./indicators');
const { isMarketOpenFor } = require('./marketHours');

const REJECTED_RETENTION_HOURS = 24;

// Delete rejected trades older than the retention window
function cleanupRejectedTrades() {
  const cutoff = new Date(Date.now() - REJECTED_RETENTION_HOURS * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const result = db.prepare(
    `DELETE FROM trades WHERE status = 'rejected' AND closed_at IS NOT NULL AND closed_at < ?`
  ).run(cutoff);

  return result.changes; // number of rows deleted
}

// A pending trade is "stale" if price has moved past its valid entry range
// without ever triggering the entry — i.e., it blew through the stop-loss
// level or the take-profit level before entry was ever reached. That means
// the original setup no longer reflects reality.
async function cleanupStalePendingTrades() {
  const pending = db.prepare(`SELECT * FROM trades WHERE status = 'pending_approval'`).all();
  let deletedCount = 0;
  const deletedNames = [];

  for (const trade of pending) {
    if (!isMarketOpenFor(trade.symbol)) continue; // don't judge staleness on frozen weekend data

    try {
      const ind = await getIndicators(trade.symbol);
      const currentPrice = ind.price;
      const entry = Number(trade.entry);
      const stopLoss = Number(trade.stop_loss);
      const takeProfit = Number(trade.take_profit);
      const isBuy = trade.direction === 'BUY';

      let isStale = false;
      if (isBuy) {
        // Valid range for an unfilled BUY is between stopLoss and takeProfit.
        // If price already fell below stop or ran above target without ever
        // filling the entry, the setup is dead.
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
