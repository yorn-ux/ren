const { getCandles } = require('./indicators');

// Find swing highs and lows (local peaks/troughs)
function findSwingPoints(candles, lookback = 3) {
  const highs = [];
  const lows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    const before = candles.slice(i - lookback, i);
    const after = candles.slice(i + 1, i + 1 + lookback);

    const isSwingHigh = before.every(c => c.high <= current.high) && after.every(c => c.high <= current.high);
    const isSwingLow = before.every(c => c.low >= current.low) && after.every(c => c.low >= current.low);

    if (isSwingHigh) highs.push(current.high);
    if (isSwingLow) lows.push(current.low);
  }

  return { highs, lows };
}

// Group nearby price levels together (within a tolerance) to find zones tested multiple times
function clusterLevels(levels, tolerancePercent = 0.3) {
  if (levels.length === 0) return [];

  const sorted = [...levels].sort((a, b) => a - b);
  const clusters = [];
  let currentCluster = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
    const tolerance = avg * (tolerancePercent / 100);

    if (Math.abs(sorted[i] - avg) <= tolerance) {
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }
  clusters.push(currentCluster);

  return clusters
    .map(cluster => ({
      level: cluster.reduce((a, b) => a + b, 0) / cluster.length,
      touches: cluster.length,
    }))
    .filter(c => c.touches >= 2) // only keep levels tested 2+ times (real S/R, not noise)
    .sort((a, b) => b.touches - a.touches); // strongest (most touches) first
}

async function getSupportResistance(symbol) {
  const candles = await getCandles(symbol, '1h', 100);
  const currentPrice = candles[candles.length - 1].close;

  const { highs, lows } = findSwingPoints(candles);
  const resistanceLevels = clusterLevels(highs);
  const supportLevels = clusterLevels(lows);

  // Find nearest support (below price) and resistance (above price)
  const nearestResistance = resistanceLevels
    .filter(r => r.level > currentPrice)
    .sort((a, b) => a.level - b.level)[0];

  const nearestSupport = supportLevels
    .filter(s => s.level < currentPrice)
    .sort((a, b) => b.level - a.level)[0];

  return {
    currentPrice,
    nearestResistance: nearestResistance || null,
    nearestSupport: nearestSupport || null,
    allResistanceLevels: resistanceLevels.slice(0, 3),
    allSupportLevels: supportLevels.slice(0, 3),
  };
}

module.exports = { getSupportResistance };
