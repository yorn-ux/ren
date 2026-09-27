const db = require('./db');
const { isBinanceSupported } = require('./binanceSource');

function ensureSettingsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}
ensureSettingsTable();

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, String(value), String(value));
}

function getAccountBalance() {
  return parseFloat(getSetting('account_balance', '1000'));
}

function setAccountBalance(amount) {
  setSetting('account_balance', amount);
}

function getRiskPercent() {
  return parseFloat(getSetting('risk_percent', '1'));
}

function setRiskPercent(percent) {
  setSetting('risk_percent', percent);
}

function calculatePositionSize(entry, stopLoss, symbol) {
  const balance = getAccountBalance();
  const riskPercent = getRiskPercent();
  const riskAmount = balance * (riskPercent / 100);

  const priceDistance = Math.abs(entry - stopLoss);
  if (priceDistance === 0) {
    return { error: 'Entry and stop loss cannot be equal' };
  }

  const units = riskAmount / priceDistance;

  // Crypto (routed through Binance) = trade in raw units/coins, always with
  // enough decimal precision to show fractional amounts on small accounts.
  // Everything else (forex, gold) = standard lot sizing, 100,000 units/lot.
  const isCrypto = isBinanceSupported(symbol);
  const isForex = !isCrypto;

  const lots = isForex ? (units / 100000).toFixed(4) : null;

  // Always keep enough decimal precision — 6 decimals covers small accounts
  // trading fractional crypto units, and is still readable for larger ones.
  const unitsDisplay = units.toFixed(6);

  return {
    accountBalance: balance,
    riskPercent,
    riskAmount: riskAmount.toFixed(2),
    priceDistance: priceDistance.toFixed(5),
    units: unitsDisplay,
    lots,
    isForex,
  };
}

module.exports = {
  getAccountBalance,
  setAccountBalance,
  getRiskPercent,
  setRiskPercent,
  calculatePositionSize,
};
