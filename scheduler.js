const { getTradeRecommendation } = require('./brain');
const { checkOpenTrades } = require('./outcomes');
const { checkEntryAlerts } = require('./entryAlerts');
const { notify } = require('./notify');
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
        notify('Ren — Trade Outcomes', summary);
      } else {
        console.log('No trades closed this scan.');
      }
    } catch (err) {
      console.log('Outcome check failed:', err.message);
    }

    try {
      const entryHits = await checkEntryAlerts();
      if (entryHits.length > 0) {
        console.log('Entry alerts sent:', entryHits.map(e => e.name).join(', '));
      }
    } catch (err) {
      console.log('Entry alert check failed:', err.message);
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
      notify('Ren — New Setups Found', `${actionable.length} setups: ${actionable.join(' | ')}`);
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
  console.log('Scheduler running. Ren will scan every hour: checking outcomes, entry alerts, then scouting new setups.');
}

module.exports = { runScan, startScheduler };
