const db = require('./db');

function listPending(mode) {
  const m = mode ? mode.toLowerCase() : null;
  return m
    ? db.prepare("SELECT * FROM trades WHERE status = 'pending_approval' AND mode = ? ORDER BY id DESC").all(m)
    : db.prepare("SELECT * FROM trades WHERE status = 'pending_approval' ORDER BY id DESC").all();
}

function approveTrade(id) {
  const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND status = 'pending_approval'").get(id);
  if (!trade) return { success: false, message: `No pending trade found with id ${id}` };
  db.prepare("UPDATE trades SET status = 'open' WHERE id = ?").run(id);
  return { success: true, trade };
}

function rejectTrade(id) {
  const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND status = 'pending_approval'").get(id);
  if (!trade) return { success: false, message: `No pending trade found with id ${id}` };
  // Set closed_at so the cleanup job knows when the 24h retention clock started
  db.prepare("UPDATE trades SET status = 'rejected', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  return { success: true, trade };
}

function approveLatest(symbolOrName, mode) {
  const m = (mode || 'pulse').toLowerCase();
  const trade = db.prepare(`
    SELECT * FROM trades
    WHERE status = 'pending_approval' AND mode = ? AND (symbol LIKE ? OR name LIKE ?)
    ORDER BY id DESC LIMIT 1
  `).get(m, `%${symbolOrName}%`, `%${symbolOrName}%`);
  if (!trade) return { success: false, message: `No pending trade found matching "${symbolOrName}" in mode ${m}` };
  return approveTrade(trade.id);
}

function rejectLatest(symbolOrName, mode) {
  const m = (mode || 'pulse').toLowerCase();
  const trade = db.prepare(`
    SELECT * FROM trades
    WHERE status = 'pending_approval' AND mode = ? AND (symbol LIKE ? OR name LIKE ?)
    ORDER BY id DESC LIMIT 1
  `).get(m, `%${symbolOrName}%`, `%${symbolOrName}%`);
  if (!trade) return { success: false, message: `No pending trade found matching "${symbolOrName}" in mode ${m}` };
  return rejectTrade(trade.id);
}

module.exports = { listPending, approveTrade, rejectTrade, approveLatest, rejectLatest };
