const { getTradeRecommendation } = require('./brain');
const { checkOpenTrades } = require('./outcomes');
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

    try {
      const outcomes = await checkOpenTrades();
      if (outcomes.length > 0) {
        const summary = outcomes.map(o => `${o.name} ${o.ratio} ${o.outcome === 'hit_tp' ? 'hit target' : 'hit stop'}`).join('. ');
        console.log('Outcomes:', summary);
        speak(`Update on past calls. ${summary}.`);
      } else {
        console.log('No trades closed this scan.');
      }
    } catch (err) {
      console.log('Outcome check failed:', err.message);
    }

    const actionable = [];

    for (const asset of watchlist) {
      try {
        const result = await getTradeRecommendation(asset.symbol, asset.name);
        if (result.hasSetup) {
          console.log(`${asset.name}: ${result.ratio} setup, confidence ${result.confidence}`);
          if (result.confidence === 'high' || result.confidence === 'medium') {
            actionable.push(`${asset.name}: ${result.ratio} setup, entry ${result.entry}, confidence ${result.confidence}`);
          }
        } else {
          console.log(`${asset.name}: no setup detected`);
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
  console.log('Scheduler running. Ren will scan every hour: checking past trade outcomes, then scouting new setups.');
}

module.exports = { runScan, startScheduler };
