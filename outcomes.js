const db = require('./db');
const { getIndicators } = require('./indicators');

async function checkOpenTrades() {
  const openTrades = db.prepare("SELECT * FROM trades WHERE status = 'open'").all();
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

// Get win rate stats, broken down by ratio (1:2 vs 1:3) — this is what makes Ren "wiser"
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

module.exports = { checkOpenTrades, getPerformanceStats };
