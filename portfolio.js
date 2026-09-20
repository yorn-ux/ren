const db = require('./db');

const VALID_MODES = ['pulse', 'focus', 'grind'];
const VALID_CURRENCIES = ['USD', 'CENTS'];

// Seed defaults if a mode has no portfolio row yet
function seedDefaults() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO portfolios (mode, starting_balance, currency)
    VALUES (?, ?, ?)
  `);
  for (const mode of VALID_MODES) {
    insert.run(mode, 10000, 'USD');
  }
}

// Set or update a mode's starting capital + currency
function setPortfolio(mode, startingBalance, currency) {
  const m = String(mode).toLowerCase();
  if (!VALID_MODES.includes(m)) {
    return { success: false, message: `Invalid mode: ${mode}` };
  }

  const c = String(currency || 'USD').toUpperCase();
  if (!VALID_CURRENCIES.includes(c)) {
    return { success: false, message: `Invalid currency: ${currency}. Use USD or CENTS.` };
  }

  const bal = Number(startingBalance);
  if (!isFinite(bal) || bal < 0) {
    return { success: false, message: `Invalid starting balance: ${startingBalance}` };
  }

  db.prepare(`
    INSERT INTO portfolios (mode, starting_balance, currency, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(mode) DO UPDATE SET
      starting_balance = excluded.starting_balance,
      currency = excluded.currency,
      updated_at = CURRENT_TIMESTAMP
  `).run(m, bal, c);

  return { success: true, mode: m, startingBalance: bal, currency: c };
}

function getPortfolio(mode) {
  const m = String(mode).toLowerCase();
  const row = db.prepare('SELECT * FROM portfolios WHERE mode = ?').get(m);
  if (row) return row;
  // Fallback if the row is missing
  return { mode: m, starting_balance: 10000, currency: 'USD' };
}

function listPortfolios() {
  return db.prepare('SELECT * FROM portfolios ORDER BY mode').all();
}

module.exports = {
  seedDefaults,
  setPortfolio,
  getPortfolio,
  listPortfolios,
  VALID_MODES,
  VALID_CURRENCIES,
};
