const { getZoneAnalysis } = require('./zones');
const { getFailedZoneSetup } = require('./failedZone');
const { getFVGSetup } = require('./fvg');
const { getLiquiditySweeps } = require('./liquidity');
const { getIndicators } = require('./indicators');

const MAX_ENTRY_DISTANCE_PCT = 3.0;
const MISSED_MOVE_PCT = 40;

function checkTrend(direction, price, sma20, sma50) {
  if (sma50 === null) return false;
  if (direction === 'BUY') return price > sma20 && sma20 > sma50;
  return price < sma20 && sma20 < sma50;
}

function evaluateFreshness(direction, currentPrice, entry, target2R) {
  const isBuy = direction === 'BUY';
  const reward = Math.abs(target2R - entry);
  const distancePct = Math.abs(entry - currentPrice) / currentPrice * 100;

  const progressPct = isBuy
    ? (currentPrice - entry) / reward * 100
    : (entry - currentPrice) / reward * 100;

  if (distancePct > MAX_ENTRY_DISTANCE_PCT) {
    return {
      fresh: false,
      reason: 'too_far',
      message: `Entry ${entry} is ${distancePct.toFixed(2)}% away from current ${currentPrice} — too far to be actionable.`,
      distancePct,
      progressPct,
    };
  }

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

  if (entryAlreadyPassed) {
    return {
      fresh: false,
      reason: 'entry_passed',
      message: `Price ${currentPrice} has already moved past entry ${entry} (${distancePct.toFixed(2)}% away). Setup already triggered without you.`,
      distancePct,
      progressPct,
    };
  }

  return { fresh: true, reason: 'fresh', message: '', distancePct, progressPct };
}

// Runs the 3 real strategies (Zone, Failed Zone, FVG) independently, each
// gated by trend. Liquidity sweeps are NOT a separate strategy — they're
// checked once and attached as supporting evidence to whichever strategy
// fired, since a sweep and a failed-zone reversal are often the same event
// seen two ways. Counting them separately would double-count one signal.
async function evaluateStrategies(symbol, name = symbol) {
  const ind = await getIndicators(symbol);
  if (!ind.rsi14 || ind.sma50 === null) {
    return { hasSetup: false, message: `${name} doesn't have enough history to evaluate strategies yet.` };
  }

  const [zone, failedZone, fvg, liquidity] = await Promise.all([
    getZoneAnalysis(symbol).catch(() => ({ hasSetup: false })),
    getFailedZoneSetup(symbol).catch(() => ({ hasSetup: false })),
    getFVGSetup(symbol).catch(() => ({ hasGap: false })),
    getLiquiditySweeps(symbol).catch(() => ({ hasSweep: false })),
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

  if (fired.length === 0) {
    return {
      hasSetup: false,
      message: `${name}: no strategy confirmed a trend-aligned setup right now (checked zone, failed-zone, FVG).`,
    };
  }

  const directions = new Set(fired.map(f => f.direction));
  if (directions.size > 1) {
    return {
      hasSetup: false,
      message: `${name}: conflicting signals — some strategies point BUY, others SELL. No clean setup.`,
    };
  }

  const direction = fired[0].direction;
  const strategyNames = fired.map(f => f.name);

  // Liquidity sweep as supporting evidence: boosts grade by one tier if it
  // aligns with the trade direction, but never counted as a 4th strategy.
  const sweepAligns = liquidity.hasSweep && liquidity.sweeps.some(s => {
    const sweepDirection = s.type.includes('bearish') ? 'SELL' : 'BUY';
    return sweepDirection === direction;
  });

  let baseGrade = fired.length >= 3 ? 'A+' : fired.length === 2 ? 'A' : 'B';
  if (sweepAligns && baseGrade === 'B') baseGrade = 'A';
  else if (sweepAligns && baseGrade === 'A') baseGrade = 'A+';

  let entry, stopLoss;
  const zoneFired = fired.find(f => f.name === 'Supply/Demand Zone');
  const failedZoneFired = fired.find(f => f.name === 'Failed Zone (reclaim)');
  const fvgFired = fired.find(f => f.name === 'Fair Value Gap');

  if (zoneFired) {
    entry = zoneFired.data.entry;
    stopLoss = zoneFired.data.stopLoss;
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

  const freshness = evaluateFreshness(direction, ind.price, entry, target2R);

  const result = {
    direction,
    grade: baseGrade,
    strategiesUsed: strategyNames,
    strategyCount: fired.length,
    liquiditySweepSupport: sweepAligns,
    entry,
    stopLoss,
    target2R,
    target3R,
    indicators: ind,
    freshness,
    rawStrategyData: { zone, failedZone, fvg, liquidity },
  };

  if (!freshness.fresh) {
    return { hasSetup: false, stale: freshness.reason, message: freshness.message, ...result };
  }

  return { hasSetup: true, ...result };
}

module.exports = { evaluateStrategies, evaluateFreshness };
