// Binance public API — no key required, generous free limits, includes real volume
const SYMBOL_MAP = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT',
  'XRP/USD': 'XRPUSDT',
  'NEAR/USD': 'NEARUSDT',
  'ZEC/USD': 'ZECUSDT',
};
function isBinanceSupported(pair) {
  return SYMBOL_MAP.hasOwnProperty(pair);
}

async function getBinanceCandles(pair, interval = '1h', limit = 50) {
  const binanceSymbol = SYMBOL_MAP[pair];
  if (!binanceSymbol) throw new Error(`${pair} not mapped to a Binance symbol`);

  // Binance intervals: 1m, 5m, 15m, 1h, 4h, 1d etc. Our '1h' matches directly.
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(`Binance error: ${data.msg || 'unknown error'}`);
  }

  // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
  return data.map(k => ({
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

module.exports = { isBinanceSupported, getBinanceCandles };
