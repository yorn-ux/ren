const db = require('./db');

// Register a mode if it doesn't already exist
function registerMode(name) {
  const exists = db.prepare('SELECT * FROM modes WHERE name = ?').get(name);
  if (!exists) {
    db.prepare('INSERT INTO modes (name, active) VALUES (?, 0)').run(name);
    console.log(`Mode registered: ${name}`);
  }
}

// Switch to a given mode (deactivates all others)
function setActiveMode(name) {
  db.prepare('UPDATE modes SET active = 0').run();
  db.prepare('UPDATE modes SET active = 1 WHERE name = ?').run(name);
  console.log(`Switched to mode: ${name}`);
}

// Get the currently active mode
function getActiveMode() {
  return db.prepare('SELECT * FROM modes WHERE active = 1').get();
}

module.exports = { registerMode, setActiveMode, getActiveMode };
