// market_hours.js
// All times computed in UTC. Kenya is UTC+3 year-round.

const MARKETS = {
  CRYPTO: 'crypto',
  FOREX: 'forex',
  STOCKS: 'stocks',
};

// --- helpers ---
function nowUtc() {
  return new Date();
}

function utcDay(d = nowUtc()) {
  return d.getUTCDay(); // 0 = Sunday, 6 = Saturday
}

function utcHour(d = nowUtc()) {
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

// --- Crypto: 24/7, always open ---
function isCryptoOpen() {
  return { open: true, reason: 'Crypto trades 24/7' };
}

// --- Forex: opens Sunday 21:00 UTC, closes Friday 21:00 UTC ---
function isForexOpen() {
  const day = utcDay();
  const hour = utcHour();

  // Saturday: fully closed
  if (day === 6) {
    return { open: false, reason: 'Forex closed — weekend (Saturday)' };
  }

  // Sunday: opens at 21:00 UTC
  if (day === 0) {
    if (hour < 21) {
      return { open: false, reason: 'Forex closed — opens Sunday 21:00 UTC (00:00 EAT Monday)' };
    }
    return { open: true, reason: 'Forex open (Sunday session)' };
  }

  // Friday: closes at 21:00 UTC
  if (day === 5) {
    if (hour >= 21) {
      return { open: false, reason: 'Forex closed — weekend (Friday 21:00 UTC close)' };
    }
    return { open: true, reason: 'Forex open (Friday session)' };
  }

  // Mon-Thu: fully open
  return { open: true, reason: 'Forex open' };
}

// --- Stocks: rough approximation (US market hours) ---
// Monday–Friday, 14:30 – 21:00 UTC (roughly NYSE 9:30–16:00 ET, ignoring DST nuance)
function isStocksOpen() {
  const day = utcDay();
  const hour = utcHour();

  if (day === 0 || day === 6) {
    return { open: false, reason: 'Stocks closed — weekend' };
  }
  if (hour < 14.5 || hour >= 21) {
    return { open: false, reason: 'Stocks closed — outside US market hours' };
  }
  return { open: true, reason: 'Stocks open' };
}

// --- Infer market from symbol / name ---
// Symbols we see in your watchlist:
//   BTC/USD, ETH/USD, XRP/USD  → crypto
//   EUR/USD, GBP/USD, USD/JPY  → forex
//   AAPL, TSLA, NVDA           → stocks
function inferMarket(symbol, name = '') {
  const s = String(symbol || '').toUpperCase();
  const n = String(name || '').toUpperCase();

  const cryptoTickers = ['BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'BNB', 'LTC'];
  if (cryptoTickers.some(t => s.includes(t)) || n.includes('BITCOIN') || n.includes('ETHEREUM')) {
    return MARKETS.CRYPTO;
  }

  const fiatCodes = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'KES', 'ZAR'];
  // Forex pairs: XXX/YYY where both sides are fiat
  if (s.includes('/')) {
    const [a, b] = s.split('/');
    if (fiatCodes.includes(a) && fiatCodes.includes(b)) return MARKETS.FOREX;
  }

  return MARKETS.STOCKS;
}

// --- Main entry point ---
function getMarketStatus(symbol, name = '') {
  const market = inferMarket(symbol, name);

  switch (market) {
    case MARKETS.CRYPTO: return { market, ...isCryptoOpen() };
    case MARKETS.FOREX:  return { market, ...isForexOpen()  };
    default:             return { market, ...isStocksOpen() };
  }
}

module.exports = {
  MARKETS,
  getMarketStatus,
  inferMarket,
  isCryptoOpen,
  isForexOpen,
  isStocksOpen,
};
