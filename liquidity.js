const { getCandles } = require('./indicators');

// Find recent swing highs/lows (same logic as support_resistance.js, standalone here for simplicity)
function findSwingPoints(candles, lookback = 3) {
  const highs = [];
  const lows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    const before = candles.slice(i - lookback, i);
    const after = candles.slice(i + 1, i + 1 + lookback);

    const isSwingHigh = before.every(c => c.high <= current.high) && after.every(c => c.high <= current.high);
    const isSwingLow = before.every(c => c.low >= current.low) && after.every(c => c.low >= current.low);

    if (isSwingHigh) highs.push({ price: current.high, index: i });
    if (isSwingLow) lows.push({ price: current.low, index: i });
  }

  return { highs, lows };
}

// A sweep = a candle wicks beyond a prior swing level, then closes back inside it
function detectSweeps(candles) {
  const { highs, lows } = findSwingPoints(candles, 3);
  const sweeps = [];

  // Check the most recent 10 candles for sweep behavior
  const recentCandles = candles.slice(-10);
  const recentStartIndex = candles.length - recentCandles.length;

  recentCandles.forEach((candle, offset) => {
    const i = recentStartIndex + offset;

    // Check against prior swing highs (sell-side sweep / bearish reversal signal)
    const priorHighs = highs.filter(h => h.index < i);
    if (priorHighs.length > 0) {
      const nearestHigh = priorHighs[priorHighs.length - 1];
      const wickedAbove = candle.high > nearestHigh.price;
      const closedBelow = candle.close < nearestHigh.price;
      if (wickedAbove && closedBelow) {
        sweeps.push({
          type: 'sell-side sweep (liquidity grab above high, bearish signal)',
          sweptLevel: nearestHigh.price,
          wickHigh: candle.high,
          closeBack: candle.close,
          candlesAgo: recentCandles.length - offset,
        });
      }
    }

    // Check against prior swing lows (buy-side sweep / bullish reversal signal)
    const priorLows = lows.filter(l => l.index < i);
    if (priorLows.length > 0) {
      const nearestLow = priorLows[priorLows.length - 1];
      const wickedBelow = candle.low < nearestLow.price;
      const closedAbove = candle.close > nearestLow.price;
      if (wickedBelow && closedAbove) {
        sweeps.push({
          type: 'buy-side sweep (liquidity grab below low, bullish signal)',
          sweptLevel: nearestLow.price,
          wickLow: candle.low,
          closeBack: candle.close,
          candlesAgo: recentCandles.length - offset,
        });
      }
    }
  });

  return sweeps;
}

async function getLiquiditySweeps(symbol) {
  const candles = await getCandles(symbol, '1h', 60);
  const sweeps = detectSweeps(candles);

  return {
    hasSweep: sweeps.length > 0,
    sweeps: sweeps.slice(-3), // most recent 3 sweeps found
  };
}

module.exports = { getLiquiditySweeps };
