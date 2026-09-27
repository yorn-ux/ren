const { getTradeRecommendation } = require('./brain');
const { checkOpenTrades, checkPendingOutcomes, expireStalePending } = require('./outcomes');
const { checkEntryAlerts } = require('./entryAlerts');
const { cleanupRejectedTrades, cleanupStalePendingTrades } = require('./cleanup');
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

    // 1. Check approved/open trades for real TP/SL hits
    try {
      const outcomes = await checkOpenTrades();
      if (outcomes.length > 0) {
        const summary = outcomes.map(o => `${o.name} ${o.ratio} ${o.outcome === 'hit_tp' ? 'hit target' : 'hit stop'}`).join('. ');
        console.log('Outcomes (approved trades):', summary);
        notify('Ren — Trade Outcomes', summary);
      } else {
        console.log('No approved trades closed this scan.');
      }
    } catch (err) {
      console.log('Outcome check failed:', err.message);
    }

    // 2. Expire stale pending trades BEFORE checking pending outcomes.
    //    Kills anything that drifted too far or ran past target so it stops
    //    cluttering pending and blocking fresh analysis of the same symbol.
    try {
      const expired = await expireStalePending();
      if (expired.length > 0) {
        const summary = expired
          .map(e => `${e.name} ${e.direction} entry ${e.entry} @ ${e.price} (${e.reason})`)
          .join('. ');
        console.log('Stale pending expired:', summary);
        notify('Ren — Stale Setups Expired', summary);
      } else {
        console.log('No stale pending trades to expire.');
      }
    } catch (err) {
      console.log('Stale expiration failed:', err.message);
    }

    // 3. Check remaining live pending trades for missed TP/SL.
    //    Runs after expiration, so nothing double-flags.
    try {
      const pendingOutcomes = await checkPendingOutcomes();
      if (pendingOutcomes.length > 0) {
        const summary = pendingOutcomes.map(o => `${o.name} would have ${o.outcome === 'missed_tp' ? 'hit target' : 'hit stop'} (never approved)`).join('. ');
        console.log('Pending outcomes:', summary);
        notify('Ren — Missed Setups', summary);
      } else {
        console.log('No pending (unapproved) trades resolved this scan.');
      }
    } catch (err) {
      console.log('Pending outcome check failed:', err.message);
    }

    // 4. Entry alerts — notify when pending trades approach their entry
    try {
      const entryHits = await checkEntryAlerts();
      if (entryHits.length > 0) {
        console.log('Entry alerts sent:', entryHits.map(e => e.name).join(', '));
      }
    } catch (err) {
      console.log('Entry alert check failed:', err.message);
    }

    // 5. Cleanup — rejected trades past retention
    try {
      const rejectedDeleted = cleanupRejectedTrades();
      if (rejectedDeleted > 0) {
        console.log(`Cleaned up ${rejectedDeleted} rejected trade(s) past 24h retention.`);
      }
    } catch (err) {
      console.log('Rejected-trade cleanup failed:', err.message);
    }

    // 6. Cleanup — leftover stale pending (belt + suspenders, in case #2
    //    didn't catch something due to market being closed)
    try {
      const staleResult = await cleanupStalePendingTrades();
      if (staleResult.deletedCount > 0) {
        console.log(`Removed ${staleResult.deletedCount} genuinely stale pending trade(s): ${staleResult.deletedNames.join(', ')}`);
      }
    } catch (err) {
      console.log('Stale-pending cleanup failed:', err.message);
    }

    // 7. Scan watchlist for fresh setups
    const actionable = [];

    for (const asset of watchlist) {
      try {
        const result = await getTradeRecommendation(asset.symbol, asset.name);
        if (result.hasSetup) {
          console.log(`${asset.name}: ${result.ratio} setup, confidence ${result.confidence}`);
          if (result.confidence === 'high' || result.confidence === 'medium') {
            actionable.push(`${asset.name}: ${result.ratio} setup, entry ${result.entry}, confidence ${result.confidence}`);
          }
        } else if (result.stale) {
          console.log(`${asset.name}: stale (${result.stale})`);
        } else if (result.duplicateBlocked) {
          console.log(`${asset.name}: duplicate blocked (${result.existingPosition?.progressPercent}% to target)`);
        } else if (result.marketClosed) {
          console.log(`${asset.name}: market closed`);
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
  console.log('Scheduler running. Ren will scan every hour: outcomes → expire stale → pending outcomes → entry alerts → cleanup → new setups.');
}

module.exports = { runScan, startScheduler };
