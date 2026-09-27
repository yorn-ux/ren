const { getCandles, getIndicators } = require('./indicators');

// How close to the zone price needs to be for us to treat it as "at the zone"
// and enter at market. 0.5% is a reasonable band for 1h charts.
const NEAR_ZONE_PCT = 0.5;

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

// Determine entry based on where current price sits relative to the zone.
//
// For a DEMAND zone (BUY):
//   - price inside zone       → entry = currentPrice (enter at market now)
//   - price within NEAR band  → entry = currentPrice (essentially at zone)
//   - price above zone        → entry = zoneHigh (wait for pullback, will be
//                               rejected upstream by the freshness gate if
//                               too far away)
//   - price below zone        → entry = currentPrice (already broke down,
//                               let freshness gate decide)
//
// For a SUPPLY zone (SELL): mirrored.
function computeEntry(zone, currentPrice, direction) {
  const { zoneHigh, zoneLow } = zone;

  const insideZone = currentPrice >= zoneLow && currentPrice <= zoneHigh;

  if (direction === 'BUY') {
    const nearAbove = currentPrice > zoneHigh
      && (currentPrice - zoneHigh) / currentPrice * 100 <= NEAR_ZONE_PCT;

    if (insideZone || nearAbove) return currentPrice;
    if (currentPrice < zoneLow) return currentPrice; // broke down — freshness decides
    return zoneHigh; // waiting for pullback (likely rejected upstream)
  }

  // SELL
  const nearBelow = currentPrice < zoneLow
    && (zoneLow - currentPrice) / currentPrice * 100 <= NEAR_ZONE_PCT;

  if (insideZone || nearBelow) return currentPrice;
  if (currentPrice > zoneHigh) return currentPrice; // broke up — freshness decides
  return zoneLow; // waiting for rally (likely rejected upstream)
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
    entry = computeEntry(zone, currentPrice, direction);
    stopLoss = zone.zoneLow;
    risk = entry - stopLoss;
  } else {
    direction = 'SELL';
    entry = computeEntry(zone, currentPrice, direction);
    stopLoss = zone.zoneHigh;
    risk = stopLoss - entry;
  }

  // Guard: if entry ended up on the wrong side of the stop (can happen if
  // price broke through the zone), the setup is invalid.
  if (risk <= 0) {
    return {
      hasSetup: false,
      currentPrice,
      message: `Price has broken through the ${zone.type} zone — setup invalidated.`,
    };
  }

  const target2R = direction === 'BUY' ? entry + (risk * 2) : entry - (risk * 2);
  const target3R = direction === 'BUY' ? entry + (risk * 3) : entry - (risk * 3);

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
    indicators,
  };
}

module.exports = { getZoneAnalysis, findZones };
