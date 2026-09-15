require('dotenv').config();
const readline = require('readline');
const { listen, speak } = require('./voice');
const { analyzeAssetVoice, getTradeRecommendationVoice } = require('./brain');
const { startScheduler } = require('./scheduler');
const { getActiveMode, setActiveMode } = require('./modes');
const watchlist = require('./watchlist');

function findAsset(query) {
  const q = query.toLowerCase();
  return watchlist.find(a =>
    a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase().split('/')[0])
  );
}

async function handleCommand(input) {
  const text = input.toLowerCase().trim();

  if (text.includes('scan') || text.includes('watchlist')) {
    console.log('Starting a manual scan of the full watchlist...');
    const { runScan } = require('./scheduler');
    await runScan();
    return;
  }

  if (text.includes('mode')) {
    const mode = watchlist.some(() => false); // placeholder, modes are separate from assets
    console.log('Available modes: pulse, focus, grind. Say "switch to pulse" etc.');
    const match = text.match(/(pulse|focus|grind)/);
    if (match) {
      setActiveMode(match[1]);
      speak(`Switched to ${match[1]} mode.`);
    }
    return;
  }

  const asset = findAsset(text);
  if (!asset) {
    console.log('No matching asset found. Try an asset name, "scan", or a mode name.');
    speak("I didn't catch a valid asset or command.");
    return;
  }

  console.log(`Matched: ${asset.name}`);

  if (text.includes('trade') || text.includes('entry') || text.includes('setup')) {
    await getTradeRecommendationVoice(asset.symbol, asset.name);
  } else {
    await analyzeAssetVoice(asset.symbol, asset.name);
  }
}

function startVoiceLoop() {
  console.log('\nRen is ready. Say an asset name for a quick read, or "trade setup on [asset]" for the full plan.');
  console.log('Say "scan" to run the full watchlist, or "exit" to quit voice mode.\n');

  const loop = () => {
    let heard;
    try {
      heard = listen();
    } catch (err) {
      console.log('Listening failed:', err.message);
      setTimeout(loop, 2000);
      return;
    }

    console.log('You said:', heard);

    if (heard.toLowerCase().includes('exit') || heard.toLowerCase().includes('stop listening')) {
      console.log('Voice mode stopped. Scheduler still running in background.');
      speak('Voice mode off. Still watching the market in the background.');
      return;
    }

    handleCommand(heard).finally(() => setTimeout(loop, 1000));
  };

  loop();
}

function startTextMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== Ren — Text Mode ===');
  console.log('Commands: an asset name | "trade setup on [asset]" | "scan" | "switch to [pulse/focus/grind]" | "voice" | "exit"\n');

  const ask = () => {
    rl.question('> ', async (input) => {
      const text = input.trim().toLowerCase();

      if (text === 'exit') {
        rl.close();
        process.exit(0);
      }

      if (text === 'voice') {
        rl.close();
        startVoiceLoop();
        return;
      }

      await handleCommand(input);
      ask();
    });
  };

  ask();
}

function main() {
  console.log('=== Ren is starting up ===');
  const activeMode = getActiveMode();
  console.log(`Active mode: ${activeMode ? activeMode.name : 'none set'}`);

  startScheduler(); // background hourly scans + voice alerts always run

  startTextMenu(); // interactive front-end
}

main();
