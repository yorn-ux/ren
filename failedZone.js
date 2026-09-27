const { getCandles } = require('./indicators');
const { findZones } = require('./zones');

// A "failed zone" setup: price wicks THROUGH a zone's boundary (looks like
// it's breaking the zone), then closes back on the original side within a
// few candles — meaning the zone actually held. This confirms the zone's
// original direction independently of the zone-entry logic itself.
async function getFailedZoneSetup(symbol) {
  const candles = await getCandles(symbol, '1h', 60);
  const zones = findZones(candles);

  if (zones.length === 0) {
    return { hasSetup: false, message: 'No zones to check for failed-zone pattern.' };
  }

  const recentZone = zones[zones.length - 1];
  const recentCandles = candles.slice(-8);

  for (let i = 0; i < recentCandles.length; i++) {
    const c = recentCandles[i];

    if (recentZone.type === 'demand') {
      // Wicked below the demand zone low, but closed back above it = zone held
      const wickedThrough = c.low < recentZone.zoneLow;
      const closedBack = c.close > recentZone.zoneLow;
      if (wickedThrough && closedBack) {
        return {
          hasSetup: true,
          direction: 'BUY',
          zoneType: 'demand',
          failedLevel: recentZone.zoneLow,
          reclaimClose: c.close,
          candlesAgo: recentCandles.length - i,
        };
      }
    } else {
      const wickedThrough = c.high > recentZone.zoneHigh;
      const closedBack = c.close < recentZone.zoneHigh;
      if (wickedThrough && closedBack) {
        return {
          hasSetup: true,
          direction: 'SELL',
          zoneType: 'supply',
          failedLevel: recentZone.zoneHigh,
          reclaimClose: c.close,
          candlesAgo: recentCandles.length - i,
        };
      }
    }
  }

  return { hasSetup: false, message: 'No recent failed-zone reversal pattern detected.' };
}

module.exports = { getFailedZoneSetup };
