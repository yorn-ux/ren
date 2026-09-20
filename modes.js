const db = require('./db');

function registerMode(name) {
  const exists = db.prepare('SELECT * FROM modes WHERE name = ?').get(name);
  if (!exists) {
    db.prepare('INSERT INTO modes (name, active) VALUES (?, 0)').run(name);
    console.log(`Mode registered: ${name}`);
  }
}

function setActiveMode(name) {
  // Auto-register if missing — prevents an inconsistent "no active mode" state
  db.prepare('INSERT OR IGNORE INTO modes (name, active) VALUES (?, 0)').run(name);
  db.prepare('UPDATE modes SET active = 0').run();
  const result = db.prepare('UPDATE modes SET active = 1 WHERE name = ?').run(name);
  if (result.changes === 0) {
    console.warn(`setActiveMode: mode "${name}" not found after insert`);
    return false;
  }
  console.log(`Switched to mode: ${name}`);
  return true;
}

function getActiveMode() {
  return db.prepare('SELECT * FROM modes WHERE active = 1').get();
}

module.exports = { registerMode, setActiveMode, getActiveMode };
