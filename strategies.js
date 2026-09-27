const { getZoneAnalysis } = require('./zones');
const { getFailedZoneSetup } = require('./failedZone');
const { getFVGSetup } = require('./fvg');
const { getCRTSetup } = require('./crt');
const { getIndicators } = require('./indicators');

// --- Staleness thresholds -------------------------------------------------
// Reject setups where the move has already happened or the entry is too far.
// Tune to your trading style.
const MAX_ENTRY_DISTANCE_PCT = 3.0;   // entry >3% away from current price = too far
const MISSED_MOVE_PCT = 40;           // price >40% of the way to target = too late

function checkTrend(direction, price, sma20, sma50) {
  if (sma50 === null) return false;
  if (direction === 'BUY') return price > sma20 && sma20 > sma50;
  return price < sma20 && sma20 < sma50;
}

// Evaluate how fresh a setup is given current price vs entry/target.
// Returns { fresh, reason, message, distancePct, progressPct }
//
// Rejection reasons:
//   too_far       — entry is >MAX_ENTRY_DISTANCE_PCT away from current price
//   entry_passed  — price has moved past entry toward target (missed the trigger)
//   missed_move   — price is ≥MISSED_MOVE_PCT of the way to target
//   blown_through — price has already reached target
function evaluateFreshness(direction, currentPrice, entry, target2R) {
  const isBuy = direction === 'BUY';
  const reward = Math.abs(target2R - entry);

  const distancePct = Math.abs(entry - currentPrice) / currentPrice * 100;

  // Positive = moving toward target (missed the entry)
  // Negative = moving away from entry (deeper into the zone — potential wait)
  const progressPct = isBuy
    ? (currentPrice - entry) / reward * 100
    : (entry - currentPrice) / reward * 100;

  // 1. Entry too far to be actionable now — regardless of direction
  if (distancePct > MAX_ENTRY_DISTANCE_PCT) {
    return {
      fresh: false,
      reason: 'too_far',
      message: `Entry ${entry} is ${distancePct.toFixed(2)}% away from current ${currentPrice} — too far to be actionable.`,
      distancePct,
      progressPct,
    };
  }

  // 2. Price blew through target — dead setup
  const blownThrough = isBuy ? currentPrice >= target2R : currentPrice <= target2R;
  if (blownThrough) {
    return {
      fresh: false,
      reason: 'blown_through',
      message: `Price ${currentPrice} already reached target ${target2R} — setup is dead.`,
      distancePct,
      progressPct,
    };
  }

  // 3. Price already ran past entry toward target
  const entryAlreadyPassed = isBuy ? currentPrice > entry : currentPrice < entry;

  if (entryAlreadyPassed && progressPct >= MISSED_MOVE_PCT) {
    return {
      fresh: false,
      reason: 'missed_move',
      message: `Price ${currentPrice} is already ${Math.round(progressPct)}% of the way to target ${target2R} — entry ${entry} is gone.`,
      distancePct,
      progressPct,
    };
  }

  // 4. Price passed entry but hasn't gone far yet — still a miss
  //    (catches the "34% progress, 5% away" dead-zone case)
  if (entryAlreadyPassed) {
    return {
      fresh: false,
      reason: 'entry_passed',
      message: `Price ${currentPrice} has already moved past entry ${entry} (${distancePct.toFixed(2)}% away). Setup already triggered without you.`,
      distancePct,
      progressPct,
    };
  }

  // Otherwise fresh — entry is nearby and not yet triggered
  return {
    fresh: true,
    reason: 'fresh',
    message: '',
    distancePct,
    progressPct,
  };
}

// Runs all four strategies independently. Each must ALSO pass the trend
// gate on its own to count. Returns which ones fired, their directions,
// and picks the best available entry/SL/TP to use.
async function evaluateStrategies(symbol, name = symbol) {
  const ind = await getIndicators(symbol);
  if (!ind.rsi14 || ind.sma50 === null) {
    return { hasSetup: false, message: `${name} doesn't have enough history to evaluate strategies yet.` };
  }

  const [zone, failedZone, fvg, crt] = await Promise.all([
    getZoneAnalysis(symbol).catch(() => ({ hasSetup: false })),
    getFailedZoneSetup(symbol).catch(() => ({ hasSetup: false })),
    getFVGSetup(symbol).catch(() => ({ hasGap: false })),
    getCRTSetup(symbol, name).catch(() => ({ hasSetup: false })),
  ]);

  const fired = [];

  if (zone.hasSetup && checkTrend(zone.direction, ind.price, ind.sma20, ind.sma50)) {
    fired.push({ name: 'Supply/Demand Zone', direction: zone.direction, data: zone });
  }

  if (failedZone.hasSetup && checkTrend(failedZone.direction, ind.price, ind.sma20, ind.sma50)) {
    fired.push({ name: 'Failed Zone (reclaim)', direction: failedZone.direction, data: failedZone });
  }

  if (fvg.hasGap) {
    const fvgDirection = fvg.type === 'bullish' ? 'BUY' : 'SELL';
    if (checkTrend(fvgDirection, ind.price, ind.sma20, ind.sma50)) {
      fired.push({ name: 'Fair Value Gap', direction: fvgDirection, data: fvg });
    }
  }

  if (crt.hasSetup && crt.mssConfirmed && checkTrend(crt.direction, ind.price, ind.sma20, ind.sma50)) {
    fired.push({ name: 'CRT + Turtle Soup', direction: crt.direction, data: crt });
  }

  if (fired.length === 0) {
    return {
      hasSetup: false,
      message: `${name}: no strategy confirmed a trend-aligned setup right now (checked zone, failed-zone, FVG, CRT+TBS).`,
    };
  }

  // All fired strategies must agree on direction, or we don't have a clean signal
  const directions = new Set(fired.map(f => f.direction));
  if (directions.size > 1) {
    return {
      hasSetup: false,
      message: `${name}: conflicting signals — some strategies point BUY, others SELL. No clean setup.`,
    };
  }

  const direction = fired[0].direction;
  const strategyNames = fired.map(f => f.name);
  const grade = fired.length === 4 ? 'A+' : fired.length >= 2 ? 'A' : 'B';

  // Pick entry/SL/TP: prefer zone (most conservative, real S/D levels), then
  // CRT (has its own real levels), then failed-zone, then FVG last.
  let entry, stopLoss;
  const zoneFired = fired.find(f => f.name === 'Supply/Demand Zone');
  const crtFired = fired.find(f => f.name === 'CRT + Turtle Soup');
  const failedZoneFired = fired.find(f => f.name === 'Failed Zone (reclaim)');
  const fvgFired = fired.find(f => f.name === 'Fair Value Gap');

  if (zoneFired) {
    entry = zoneFired.data.entry;
    stopLoss = zoneFired.data.stopLoss;
  } else if (crtFired) {
    entry = crtFired.data.entry;
    stopLoss = crtFired.data.stopLoss;
  } else if (failedZoneFired) {
    entry = failedZoneFired.data.reclaimClose;
    stopLoss = failedZoneFired.data.failedLevel;
  } else if (fvgFired) {
    entry = direction === 'BUY' ? fvgFired.data.gapHigh : fvgFired.data.gapLow;
    stopLoss = direction === 'BUY' ? fvgFired.data.gapLow : fvgFired.data.gapHigh;
  }

  const risk = Math.abs(entry - stopLoss);
  const target2R = direction === 'BUY' ? entry + risk * 2 : entry - risk * 2;
  const target3R = direction === 'BUY' ? entry + risk * 3 : entry - risk * 3;

  // --- Staleness gate -----------------------------------------------------
  const freshness = evaluateFreshness(direction, ind.price, entry, target2R);

  if (!freshness.fresh) {
    return {
      hasSetup: false,
      stale: freshness.reason,
      message: freshness.message,
      direction,
      grade,
      strategiesUsed: strategyNames,
      strategyCount: fired.length,
      entry,
      stopLoss,
      target2R,
      target3R,
      indicators: ind,
      freshness,
      rawStrategyData: { zone, failedZone, fvg, crt },
    };
  }

  return {
    hasSetup: true,
    direction,
    grade,
    strategiesUsed: strategyNames,
    strategyCount: fired.length,
    entry,
    stopLoss,
    target2R,
    target3R,
    indicators: ind,
    freshness,
    rawStrategyData: { zone, failedZone, fvg, crt },
  };
}

module.exports = { evaluateStrategies, evaluateFreshness };
