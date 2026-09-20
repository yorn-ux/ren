// Forex/commodities (Twelve Data sourced) trade Sunday 5pm EST to Friday 5pm EST.
// Crypto (Binance sourced) trades 24/7, so it's never blocked here.
const { isBinanceSupported } = require('./binanceSource');

function isForexMarketOpen() {
  const now = new Date();
  // Convert to EST/EDT (UTC-5, ignoring DST nuance — good enough for open/close gating)
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const estHour = (utcHour - 5 + 24) % 24;
  const estDay = utcHour < 5 ? (utcDay - 1 + 7) % 7 : utcDay;

  // Closed: all day Saturday, and Sunday before 5pm EST
  if (estDay === 6) return false;
  if (estDay === 0 && estHour < 17) return false;
  // Closed: Friday after 5pm EST
  if (estDay === 5 && estHour >= 17) return false;

  return true;
}

function isMarketOpenFor(symbol) {
  if (isBinanceSupported(symbol)) return true; // crypto: always open
  return isForexMarketOpen(); // forex/gold: subject to weekend closure
}

module.exports = { isMarketOpenFor, isForexMarketOpen };
