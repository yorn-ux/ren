const { getTradeRecommendation } = require('./brain');
const { checkOpenTrades, expireStalePending } = require('./outcomes');
const { getMarketStatus } = require('./market_hours');
const { speak } = require('./voice');
const watchlist = require('./watchlist');

let scanInProgress = false;

async function runScan() {
  if (scanInProgress) {
    console.log('Scan already in progress, skipping this trigger.');
    return;
  }
  scanInProgress = true;

  try {
    console.log(`\n--- Scan started: ${new Date().toLocaleTimeString()} ---`);

    // 1. Check open trades for TP / SL hits
    try {
      const outcomes = await checkOpenTrades();
      if (outcomes.length > 0) {
        const summary = outcomes.map(o =>
          `${o.name} ${o.ratio} ${o.outcome === 'hit_tp' ? 'hit target' : 'hit stop'}`
        ).join('. ');
        console.log('Outcomes:', summary);
        speak(`Update on past calls. ${summary}.`);
      } else {
        console.log('No trades closed this scan.');
      }
    } catch (err) {
      console.log('Outcome check failed:', err.message);
    }

    // 2. Expire pending trades whose entry has already been hit
    try {
      const expired = await expireStalePending();
      if (expired.length > 0) {
        const summary = expired.map(e =>
          `${e.name} (${e.direction} entry ${e.entry} hit at ${e.price})`
        ).join('. ');
        console.log('Expired pending:', summary);
        speak(`Expired ${expired.length} stale setup${expired.length > 1 ? 's' : ''}. ${summary}.`);
      } else {
        console.log('No stale pending trades.');
      }
    } catch (err) {
      console.log('Expiration check failed:', err.message);
    }

    // 3. Scan watchlist — skip closed markets
    const actionable = [];

    for (const asset of watchlist) {
      const status = getMarketStatus(asset.symbol, asset.name);
      if (!status.open) {
        console.log(`${asset.name}: skipped — ${status.reason}`);
        continue;
      }

      try {
        const result = await getTradeRecommendation(asset.symbol, asset.name);
        if (result.hasSetup) {
          console.log(`${asset.name}: ${result.ratio} setup, confidence ${result.confidence}`);
          if (result.confidence === 'high' || result.confidence === 'medium') {
            actionable.push(`${asset.name}: ${result.ratio} setup, entry ${result.entry}, confidence ${result.confidence}`);
          }
        } else {
          const reason = result.marketClosed ? 'market closed' : 'no setup detected';
          console.log(`${asset.name}: ${reason}`);
        }
      } catch (err) {
        console.log(`${asset.name}: failed (${err.message})`);
      }
    }

    if (actionable.length > 0) {
      speak(`Scan complete. ${actionable.length} setups worth a look: ${actionable.join('. ')}. That's the read. Your call.`);
    } else {
      console.log('No actionable setups this scan. Staying quiet.');
    }

    console.log(`--- Scan finished: ${new Date().toLocaleTimeString()} ---`);
  } finally {
    scanInProgress = false;
  }
}

function startScheduler() {
  runScan();
  setInterval(runScan, 60 * 60 * 1000);
  console.log('Scheduler running. Ren will scan every hour: checking past trade outcomes, expiring stale setups, then scouting new setups.');
}

module.exports = { runScan, startScheduler };
