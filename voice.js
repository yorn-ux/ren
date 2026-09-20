const { execSync } = require('child_process');

// Master switch — set to false to fully disable Termux:API voice (mic + speaker).
// Everything that calls speak()/listen() keeps working silently instead of erroring.
const VOICE_ENABLED = false;

function listen() {
  if (!VOICE_ENABLED) {
    throw new Error('Voice input is disabled. Use the dashboard instead.');
  }
  try {
    const result = execSync('termux-speech-to-text', { encoding: 'utf-8' });
    return result.trim();
  } catch (err) {
    throw new Error('Speech recognition failed: ' + err.message);
  }
}

function speak(text) {
  if (!VOICE_ENABLED) return; // no-op — dashboard is now the primary interface
  const safeText = text.replace(/"/g, '\\"');
  execSync(`termux-tts-speak "${safeText}"`);
}

module.exports = { listen, speak };
