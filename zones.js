const { getCandles, getIndicators } = require('./indicators');

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

// Gathers everything needed to judge the setup — no ratio decision made here
async function getZoneAnalysis(symbol) {
  const candles = await getCandles(symbol, '1h', 60);
  const zones = findZones(candles);
  const currentPrice = candles[candles.length - 1].close;
  const indicators = await getIndicators(symbol);

  if (zones.length === 0) {
    return { hasSetup: false, currentPrice, message: 'No clear supply/demand zone detected recently.' };
  }

  const zone = zones[zones.length - 1];
  let entry, stopLoss, direction, risk;

  if (zone.type === 'demand') {
    direction = 'BUY';
    entry = zone.zoneHigh;
    stopLoss = zone.zoneLow;
    risk = entry - stopLoss;
  } else {
    direction = 'SELL';
    entry = zone.zoneLow;
    stopLoss = zone.zoneHigh;
    risk = stopLoss - entry;
  }

  const target2R = direction === 'BUY' ? entry + (risk * 2) : entry - (risk * 2);
  const target3R = direction === 'BUY' ? entry + (risk * 3) : entry - (risk * 3);

  // Check for other zones sitting between entry and the 3R target (potential obstacles)
  const pathMin = Math.min(target3R, entry);
  const pathMax = Math.max(target3R, entry);
  const obstacleZones = zones
    .filter(z => z !== zone)
    .filter(z => {
      const zMid = (z.zoneHigh + z.zoneLow) / 2;
      return zMid > pathMin && zMid < pathMax;
    });

  return {
    hasSetup: true,
    currentPrice,
    zoneType: zone.type,
    zoneHigh: zone.zoneHigh,
    zoneLow: zone.zoneLow,
    direction,
    entry,
    stopLoss,
    risk,
    target2R,
    target3R,
    obstacleCount: obstacleZones.length,
    indicators, // { price, sma20, sma50, rsi14 }
  };
}

module.exports = { getZoneAnalysis };
