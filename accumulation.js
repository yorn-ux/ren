const { getCandles } = require('./indicators');

// Money Flow Multiplier + Money Flow Volume, cumulative = A/D Line
function calcAD(candles) {
  let adLine = 0;
  const adValues = [];

  for (const c of candles) {
    const range = c.high - c.low;
    if (range === 0 || c.volume === 0) {
      adValues.push(adLine);
      continue;
    }
    const moneyFlowMultiplier = ((c.close - c.low) - (c.high - c.close)) / range;
    const moneyFlowVolume = moneyFlowMultiplier * c.volume;
    adLine += moneyFlowVolume;
    adValues.push(adLine);
  }

  return adValues;
}

async function getAccumulationDistribution(symbol) {
  const candles = await getCandles(symbol, '1h', 50);
  const hasVolume = candles.some(c => c.volume > 0);

  if (!hasVolume) {
    return { available: false, message: 'No real volume data for this asset (common for forex pairs).' };
  }

  const adValues = calcAD(candles);
  const current = adValues[adValues.length - 1];
  const previous = adValues[adValues.length - 6] || adValues[0]; // ~6 periods back for trend

  const trend = current > previous ? 'accumulation' : current < previous ? 'distribution' : 'flat';

  return {
    available: true,
    adLine: current,
    trend, // 'accumulation' = buying pressure, 'distribution' = selling pressure
    changeOverPeriod: current - previous,
  };
}

module.exports = { getAccumulationDistribution };
