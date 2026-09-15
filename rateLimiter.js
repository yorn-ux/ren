let lastCallTime = 0;
const MIN_INTERVAL_MS = 8000; // ~7.5 calls/minute, safely under the 8/min free tier limit

async function waitForSlot() {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  lastCallTime = Date.now();
}

module.exports = { waitForSlot };
