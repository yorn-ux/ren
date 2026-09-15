const { analyzeAsset } = require('./brain');
const { speak } = require('./voice');
const watchlist = require('./watchlist');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runScan() {
  console.log(`\n--- Scan started: ${new Date().toLocaleTimeString()} ---`);
  const actionable = [];

  for (const asset of watchlist) {
    try {
      const suggestion = await analyzeAsset(asset.symbol, asset.name);
      const direction = suggestion.match(/\*\*Direction:\*\*\s*(\w+)/i);
      const call = direction ? direction[1].toUpperCase() : 'UNKNOWN';

      console.log(`${asset.name}: ${call}`);

      if (call === 'BUY' || call === 'SELL') {
        actionable.push(`${asset.name}: ${call}`);
      }
    } catch (err) {
      console.log(`${asset.name}: failed (${err.message})`);
    }
    await delay(8000); // respect free-tier rate limits
  }

  if (actionable.length > 0) {
    speak(`Scan complete. ${actionable.length} actionable signals: ${actionable.join(', ')}. Check your dashboard for details.`);
  } else {
    console.log('No actionable signals this scan. Staying quiet.');
  }
}

// Run immediately, then every hour
runScan();
setInterval(runScan, 60 * 60 * 1000);

console.log('Scheduler running. Ren will scan every hour and speak up only on BUY/SELL signals.');
