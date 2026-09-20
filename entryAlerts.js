const db = require('./db');
const { getIndicators } = require('./indicators');
const { notify } = require('./notify');
const { isMarketOpenFor } = require('./marketHours');

const WATCHABLE_STATUSES = ['pending_approval', 'approved', 'open'];

async function checkEntryAlerts() {
  const placeholders = WATCHABLE_STATUSES.map(() => '?').join(',');
  const trades = db.prepare(
    `SELECT * FROM trades WHERE status IN (${placeholders}) AND entry_alert_sent = 0`
  ).all(...WATCHABLE_STATUSES);

  const triggered = [];

  for (const trade of trades) {
    if (!isMarketOpenFor(trade.symbol)) {
      continue; // skip stale weekend data entirely — don't check, don't alert
    }

    try {
      const ind = await getIndicators(trade.symbol);
      const currentPrice = ind.price;
      const entry = Number(trade.entry);

      const tolerance = entry * 0.0005;
      const isBuy = trade.direction === 'BUY';

      const reached = isBuy
        ? currentPrice <= entry + tolerance
        : currentPrice >= entry - tolerance;

      if (reached) {
        notify(
          `Ren — Entry Hit: ${trade.name}`,
          `${trade.direction} entry ${entry} reached (current: ${currentPrice.toFixed(5)}). SL ${trade.stop_loss} / TP ${trade.take_profit}.`
        );
        db.prepare('UPDATE trades SET entry_alert_sent = 1 WHERE id = ?').run(trade.id);
        triggered.push({ id: trade.id, name: trade.name, currentPrice });
      }
    } catch (err) {
      console.log(`Entry check failed for ${trade.name}: ${err.message}`);
    }
  }

  return triggered;
}

module.exports = { checkEntryAlerts };
