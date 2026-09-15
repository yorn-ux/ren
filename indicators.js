require('dotenv').config();
const { waitForSlot } = require('./rateLimiter');
const { isBinanceSupported, getBinanceCandles } = require('./binanceSource');

async function getHistory(pair = 'EUR/USD', interval = '1h', outputsize = 50) {
  if (isBinanceSupported(pair)) {
    const candles = await getBinanceCandles(pair, interval, outputsize);
    return candles.map(c => c.close);
  }

  await waitForSlot();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(pair)}&interval=${interval}&outputsize=${outputsize}&apikey=${process.env.TWELVEDATA_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === 'error') throw new Error(data.message);
  return data.values.map(v => parseFloat(v.close)).reverse();
}

async function getCandles(pair = 'EUR/USD', interval = '1h', outputsize = 50) {
  if (isBinanceSupported(pair)) {
    return await getBinanceCandles(pair, interval, outputsize);
  }

  await waitForSlot();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(pair)}&interval=${interval}&outputsize=${outputsize}&apikey=${process.env.TWELVEDATA_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === 'error') throw new Error(data.message);
  return data.values.map(v => ({
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    open: parseFloat(v.open),
    volume: v.volume ? parseFloat(v.volume) : 0,
  })).reverse();
}

function calcSMA(closes, period) {
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function getIndicators(pair = 'EUR/USD') {
  const closes = await getHistory(pair);
  const currentPrice = closes[closes.length - 1];
  return {
    price: currentPrice,
    sma20: calcSMA(closes, 20),
    sma50: closes.length >= 50 ? calcSMA(closes, 50) : null,
    rsi14: calcRSI(closes, 14),
  };
}

module.exports = { getIndicators, getCandles };
