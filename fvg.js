const { getCandles } = require('./indicators');

// A Fair Value Gap (FVG) is a 3-candle pattern where candle 1 and candle 3
// don't overlap in price range — meaning candle 2 moved so fast it skipped
// a price zone. Bullish FVG = candle1.high < candle3.low. Bearish FVG =
// candle1.low > candle3.high.
function findFVGs(candles) {
  const gaps = [];

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];

    if (c1.high < c3.low) {
      gaps.push({
        type: 'bullish',
        gapLow: c1.high,
        gapHigh: c3.low,
        index: i,
      });
    } else if (c1.low > c3.high) {
      gaps.push({
        type: 'bearish',
        gapLow: c3.high,
        gapHigh: c1.low,
        index: i,
      });
    }
  }

  return gaps;
}

async function getFVGSetup(symbol) {
  const candles = await getCandles(symbol, '1h', 40);
  const currentPrice = candles[candles.length - 1].close;
  const gaps = findFVGs(candles);

  if (gaps.length === 0) {
    return { hasGap: false, message: 'No recent Fair Value Gap detected.' };
  }

  // Only care about gaps price hasn't fully filled yet — current price still
  // sitting inside or near the gap zone, since that's the tradeable case.
  const recentGaps = gaps.slice(-5);
  const unfilled = recentGaps.filter(g => currentPrice >= g.gapLow && currentPrice <= g.gapHigh);

  if (unfilled.length === 0) {
    return { hasGap: false, message: 'FVGs detected but all have been filled already — no active zone.' };
  }

  const gap = unfilled[unfilled.length - 1];
  return {
    hasGap: true,
    type: gap.type, // 'bullish' or 'bearish'
    gapLow: gap.gapLow,
    gapHigh: gap.gapHigh,
    candlesAgo: candles.length - gap.index,
  };
}

module.exports = { getFVGSetup };
