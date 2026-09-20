const { execSync } = require('child_process');

function notify(title, content) {
  try {
    const safeTitle = title.replace(/"/g, '\\"');
    const safeContent = content.replace(/"/g, '\\"');
    execSync(`termux-notification --title "${safeTitle}" --content "${safeContent}"`);
  } catch (err) {
    console.log('Notification failed:', err.message);
  }
}

module.exports = { notify };
