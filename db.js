const Database = require('better-sqlite3');
const db = new Database('ren.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS modes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    active INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry REAL NOT NULL,
    stop_loss REAL NOT NULL,
    take_profit REAL NOT NULL,
    ratio TEXT,
    status TEXT DEFAULT 'open',
    entry_alert_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
  );
`);

// ALTER TABLE guard: CREATE TABLE IF NOT EXISTS won't add new columns to an
// already-existing table, so this ensures entry_alert_sent exists even on a
// database created before this column was added.
try {
  const cols = db.prepare('PRAGMA table_info(trades)').all();
  const hasColumn = cols.some(c => c.name === 'entry_alert_sent');
  if (!hasColumn) {
    db.exec('ALTER TABLE trades ADD COLUMN entry_alert_sent INTEGER DEFAULT 0');
    console.log('Migrated: added entry_alert_sent column to trades table');
  }
} catch (err) {
  console.log('Migration check failed:', err.message);
}

module.exports = db;
