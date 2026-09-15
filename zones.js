const { getCandles } = require('./indicators');

function findZones(candles) {
  const zones = [];

  for (let i = 5; i < candles.length - 5; i++) {
    const current = candles[i];
    const before = candles.slice(i - 5, i);
    const after = candles.slice(i + 1, i + 6);

    const beforeRange = Math.max(...before.map(c => c.high)) - Math.min(...before.map(c => c.low));
    const afterMove = after[after.length - 1].close - current.close;

    const avgCandleSize = before.reduce((sum, c) => sum + (c.high - c.low), 0) / before.length;
    const isConsolidation = beforeRange < avgCandleSize * 3;
    const isStrongMove = Math.abs(afterMove) > avgCandleSize * 2;

    if (isConsolidation && isStrongMove) {
      zones.push({
        type: afterMove > 0 ? 'demand' : 'supply',
        zoneHigh: Math.max(...before.map(c => c.high)),
        zoneLow: Math.min(...before.map(c => c.low)),
        index: i,
      });
    }
  }

  return zones;
}

async function getTradeSetup(symbol, ratio = 2) {
  const candles = await getCandles(symbol, '1h', 60);
  const zones = findZones(candles);
  const currentPrice = candles[candles.length - 1].close;

  if (zones.length === 0) {
    return { hasSetup: false, currentPrice, message: 'No clear supply/demand zone detected recently.' };
  }

  const zone = zones[zones.length - 1];

  let entry, stopLoss, takeProfit, direction;

  if (zone.type === 'demand') {
    direction = 'BUY';
    entry = zone.zoneHigh;
    stopLoss = zone.zoneLow;
    const risk = entry - stopLoss;
    takeProfit = entry + (risk * ratio);
  } else {
    direction = 'SELL';
    entry = zone.zoneLow;
    stopLoss = zone.zoneHigh;
    const risk = stopLoss - entry;
    takeProfit = entry - (risk * ratio);
  }

  return {
    hasSetup: true,
    currentPrice,
    zoneType: zone.type,
    direction,
    entry: entry.toFixed(5),
    stopLoss: stopLoss.toFixed(5),
    takeProfit: takeProfit.toFixed(5),
    ratio: `1:${ratio}`,
  };
}

module.exports = { getTradeSetup };
