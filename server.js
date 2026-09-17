require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const { listPending, approveTrade, rejectTrade } = require('./approvals');
const { getPerformanceStats } = require('./outcomes');
const { getActiveMode, setActiveMode } = require('./modes');
const { getTradeRecommendation } = require('./brain');
const { runScan } = require('./scheduler');
const watchlist = require('./watchlist');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/pending', (req, res) => {
  res.json(listPending());
});

app.post('/api/approve/:id', (req, res) => {
  const result = approveTrade(parseInt(req.params.id));
  res.json(result);
});

app.post('/api/reject/:id', (req, res) => {
  const result = rejectTrade(parseInt(req.params.id));
  res.json(result);
});

app.get('/api/trades', (req, res) => {
  const trades = db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 50').all();
  res.json(trades);
});

app.get('/api/stats', (req, res) => {
  res.json(getPerformanceStats());
});

app.get('/api/mode', (req, res) => {
  res.json(getActiveMode());
});

app.post('/api/mode/:name', (req, res) => {
  setActiveMode(req.params.name);
  res.json({ success: true, mode: req.params.name });
});

app.get('/api/watchlist', (req, res) => {
  res.json(watchlist);
});

app.post('/api/analyze/:symbol/:name', async (req, res) => {
  try {
    const result = await getTradeRecommendation(req.params.symbol, req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan', async (req, res) => {
  runScan().catch(err => console.log('Scan error:', err.message));
  res.json({ started: true });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Ren dashboard running at http://localhost:${PORT}`);
});
