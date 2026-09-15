const { execSync } = require('child_process');

function listen() {
  try {
    const result = execSync('termux-speech-to-text', { encoding: 'utf-8' });
    return result.trim();
  } catch (err) {
    throw new Error('Speech recognition failed: ' + err.message);
  }
}

function speak(text) {
  // Escape double quotes so they don't break the shell command
  const safeText = text.replace(/"/g, '\\"');
  execSync(`termux-tts-speak "${safeText}"`);
}

module.exports = { listen, speak };
