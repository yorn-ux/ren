let queue = Promise.resolve();
const MIN_INTERVAL_MS = 9000;

function waitForSlot() {
  const result = queue.then(() => new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS)));
  queue = result;
  return result;
}

module.exports = { waitForSlot };
