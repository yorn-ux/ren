const { getZoneAnalysis } = require('./zones');
const { getFailedZoneSetup } = require('./failedZone');
const { getFVGSetup } = require('./fvg');
const { getCRTSetup } = require('./crt');
const { getIndicators } = require('./indicators');

function checkTrend(direction, price, sma20, sma50) {
  if (sma50 === null) return false;
  if (direction === 'BUY') return price > sma20 && sma20 > sma50;
  return price < sma20 && sma20 < sma50;
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
    rawStrategyData: { zone, failedZone, fvg, crt },
  };
}

module.exports = { evaluateStrategies };
