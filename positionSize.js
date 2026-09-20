const db = require('./db');

// Simple key-value settings table for things like account balance and risk %
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

// Core calculation: given entry/stop and account settings, how many units
// (or lots, for forex) should be traded to risk exactly the configured %.
function calculatePositionSize(entry, stopLoss, symbol) {
  const balance = getAccountBalance();
  const riskPercent = getRiskPercent();
  const riskAmount = balance * (riskPercent / 100);

  const priceDistance = Math.abs(entry - stopLoss);
  if (priceDistance === 0) {
    return { error: 'Entry and stop loss cannot be equal' };
  }

  // Units of the asset such that (units * priceDistance) = riskAmount
  const units = riskAmount / priceDistance;

  // Forex lot sizing: standard lot = 100,000 units of base currency
  const isForex = symbol.includes('/') && !['BTC', 'ETH', 'SOL', 'XRP', 'XAU'].some(c => symbol.startsWith(c));
  const lots = isForex ? (units / 100000).toFixed(3) : null;

  return {
    accountBalance: balance,
    riskPercent,
    riskAmount: riskAmount.toFixed(2),
    priceDistance: priceDistance.toFixed(5),
    units: units.toFixed(isForex ? 0 : 6),
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
