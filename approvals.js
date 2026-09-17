const db = require('./db');

function listPending() {
  return db.prepare("SELECT * FROM trades WHERE status = 'pending_approval' ORDER BY id DESC").all();
}

function approveTrade(id) {
  const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND status = 'pending_approval'").get(id);
  if (!trade) return { success: false, message: `No pending trade found with id ${id}` };

  db.prepare("UPDATE trades SET status = 'approved' WHERE id = ?").run(id);
  return { success: true, trade };
}

function rejectTrade(id) {
  const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND status = 'pending_approval'").get(id);
  if (!trade) return { success: false, message: `No pending trade found with id ${id}` };

  db.prepare("UPDATE trades SET status = 'rejected' WHERE id = ?").run(id);
  return { success: true, trade };
}

function approveLatest(symbolOrName) {
  const trade = db.prepare(
    "SELECT * FROM trades WHERE status = 'pending_approval' AND (symbol LIKE ? OR name LIKE ?) ORDER BY id DESC LIMIT 1"
  ).get(`%${symbolOrName}%`, `%${symbolOrName}%`);

  if (!trade) return { success: false, message: `No pending trade found matching "${symbolOrName}"` };

  return approveTrade(trade.id);
}

function rejectLatest(symbolOrName) {
  const trade = db.prepare(
    "SELECT * FROM trades WHERE status = 'pending_approval' AND (symbol LIKE ? OR name LIKE ?) ORDER BY id DESC LIMIT 1"
  ).get(`%${symbolOrName}%`, `%${symbolOrName}%`);

  if (!trade) return { success: false, message: `No pending trade found matching "${symbolOrName}"` };

  return rejectTrade(trade.id);
}

module.exports = { listPending, approveTrade, rejectTrade, approveLatest, rejectLatest };
