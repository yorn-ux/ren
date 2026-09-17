const { getCandles } = require('./indicators');
const { isBinanceSupported } = require('./binanceSource');

// Get the previous completed daily candle's high/low as the CRT range
async function getDailyRange(symbol) {
  const dailyInterval = isBinanceSupported(symbol) ? '1d' : '1day';
  const dailyCandles = await getCandles(symbol, dailyInterval, 3);
  const previousDay = dailyCandles[dailyCandles.length - 2];
  return { high: previousDay.high, low: previousDay.low };
}

// Check recent lower-timeframe candles for a Turtle Soup: sweep beyond the
// range, then close back inside it.
function findTurtleSoup(range, recentCandles) {
  for (let i = recentCandles.length - 1; i >= Math.max(0, recentCandles.length - 12); i--) {
    const c = recentCandles[i];

    // Sweep above daily high, close back below it = bearish Turtle Soup
    if (c.high > range.high && c.close < range.high) {
      return {
        type: 'bearish',
        sweptLevel: range.high,
        wickPrice: c.high,
        closeBack: c.close,
        candlesAgo: recentCandles.length - i,
      };
    }

    // Sweep below daily low, close back above it = bullish Turtle Soup
    if (c.low < range.low && c.close > range.low) {
      return {
        type: 'bullish',
        sweptLevel: range.low,
        wickPrice: c.low,
        closeBack: c.close,
        candlesAgo: recentCandles.length - i,
      };
    }
  }
  return null;
}

// Basic Market Structure Shift: after the sweep, did price make a
// lower-high-then-break-down (bearish) or higher-low-then-break-up (bullish)?
function checkMSS(soup, candlesAfterSweep) {
  if (candlesAfterSweep.length < 3) return { confirmed: false, reason: 'Not enough candles yet since the sweep' };

  const closes = candlesAfterSweep.map(c => c.close);

  if (soup.type === 'bearish') {
    const brokeLower = closes[closes.length - 1] < Math.min(...closes.slice(0, -1));
    return { confirmed: brokeLower, reason: brokeLower ? 'Price broke below recent structure after the sweep' : 'No confirmed break down yet' };
  } else {
    const brokeHigher = closes[closes.length - 1] > Math.max(...closes.slice(0, -1));
    return { confirmed: brokeHigher, reason: brokeHigher ? 'Price broke above recent structure after the sweep' : 'No confirmed break up yet' };
  }
}

async function getCRTSetup(symbol, name = symbol) {
  const range = await getDailyRange(symbol);
  const recentCandles = await getCandles(symbol, '1h', 30);

  const soup = findTurtleSoup(range, recentCandles);

  if (!soup) {
    return { hasSetup: false, message: `No CRT/Turtle Soup sweep detected on ${name}'s daily range recently.` };
  }

  const candlesAfterSweep = recentCandles.slice(recentCandles.length - soup.candlesAgo);
  const mss = checkMSS(soup, candlesAfterSweep);

  const currentPrice = recentCandles[recentCandles.length - 1].close;
  const direction = soup.type === 'bearish' ? 'SELL' : 'BUY';
  const entry = currentPrice;
  const stopLoss = soup.wickPrice;
  const takeProfit = soup.type === 'bearish' ? range.low : range.high;

  return {
    hasSetup: true,
    direction,
    dailyRange: range,
    sweep: soup,
    mssConfirmed: mss.confirmed,
    mssReason: mss.reason,
    entry,
    stopLoss,
    takeProfit,
  };
}

module.exports = { getCRTSetup };
