require('dotenv').config();
const readline = require('readline');
const { listen, speak } = require('./voice');
const { analyzeAssetVoice, getTradeRecommendationVoice } = require('./brain');
const { startScheduler, runScan } = require('./scheduler');
const { getActiveMode, setActiveMode } = require('./modes');
const { listPending, approveLatest, rejectLatest } = require('./approvals');
const watchlist = require('./watchlist');

// Import and launch the Express web server automatically
try {
  require('./server');
  console.log('✔ Express Web Server initialized on http://localhost:3000');
} catch (err) {
  console.error('⚠️ Could not auto-start server.js:', err.message);
}

function findAsset(query) {
  const q = query.toLowerCase();
  return watchlist.find(a =>
    a.name.toLowerCase().includes(q) || 
    q.includes(a.name.toLowerCase().split('/')[0]) ||
    a.symbol.toLowerCase() === q
  );
}

async function handleCommand(input) {
  const text = input.toLowerCase().trim();
  if (!text) return;

  if (text === 'pending' || text.includes('show pending')) {
    const pending = listPending();
    if (pending.length === 0) {
      console.log('No trades pending approval.');
      speak('Nothing pending right now.');
    } else {
      console.log('\n--- Pending Approvals ---');
      pending.forEach(t => {
        console.log(`[${t.id}] ${t.name} ${t.direction} @ ${t.entry} | SL ${t.stop_loss} | TP ${t.take_profit} | ${t.ratio}`);
      });
      speak(`You have ${pending.length} trades pending approval. Check the screen for details.`);
    }
    return;
  }

  if (text.startsWith('approve')) {
    const target = text.replace('approve', '').trim();
    const result = approveLatest(target);
    if (result.success) {
      console.log(`Approved: ${result.trade.name} ${result.trade.direction} @ ${result.trade.entry}`);
      speak(`Approved. Tracking ${result.trade.name} now.`);
    } else {
      console.log(result.message);
      speak(result.message);
    }
    return;
  }

  if (text.startsWith('reject')) {
    const target = text.replace('reject', '').trim();
    const result = rejectLatest(target);
    if (result.success) {
      console.log(`Rejected: ${result.trade.name} ${result.trade.direction} @ ${result.trade.entry}`);
      speak(`Rejected. Won't track that one.`);
    } else {
      console.log(result.message);
      speak(result.message);
    }
    return;
  }

  if (text.includes('scan') || text.includes('watchlist')) {
    console.log('Starting a manual scan of the full watchlist...');
    await runScan();
    return;
  }

  if (text.includes('mode')) {
    const match = text.match(/(pulse|focus|grind)/);
    if (match) {
      setActiveMode(match[1]);
      console.log(`Active mode set to: ${match[1]}`);
      speak(`Switched to ${match[1]} mode.`);
    } else {
      console.log('Available modes: pulse, focus, grind. Example: "switch to pulse"');
    }
    return;
  }

  const asset = findAsset(text);
  if (!asset) {
    console.log('No matching asset found. Try an asset name, "scan", "pending", "approve/reject [asset]", or a mode name.');
    speak("I didn't catch a valid asset or command.");
    return;
  }

  console.log(`Matched: ${asset.name} (${asset.symbol})`);

  try {
    if (text.includes('trade') || text.includes('entry') || text.includes('setup')) {
      await getTradeRecommendationVoice(asset.symbol, asset.name);
    } else {
      await analyzeAssetVoice(asset.symbol, asset.name);
    }
  } catch (err) {
    console.error(`Execution error for ${asset.name}:`, err.message);
    speak(`Failed to complete analysis for ${asset.name}. Check logs.`);
  }
}

function startVoiceLoop() {
  console.log('\nRen is ready. Say an asset name for a quick read, or "trade setup on [asset]" for the full plan.');
  console.log('Say "pending", "approve [asset]", "reject [asset]", "scan", or "exit" to quit voice mode.\n');

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
      startTextMenu();
      return;
    }

    handleCommand(heard).finally(() => setTimeout(loop, 1000));
  };

  loop();
}

function startTextMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== Ren — System Operational ===');
  console.log('Commands: [asset name] | "trade setup on [asset]" | "scan" | "pending" | "approve [asset]" | "reject [asset]" | "switch to [pulse/focus/grind]" | "voice" | "exit"\n');

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

      try {
        await handleCommand(input);
      } catch (err) {
        console.error("Error processing command:", err);
      }
      
      ask();
    });
  };

  ask();
}

function main() {
  console.log('=== REN SYSTEM STARTUP ===');
  const activeMode = getActiveMode();
  console.log(`Active mode: ${activeMode ? activeMode.name : 'pulse'}`);

  startScheduler();
  startTextMenu();
}

main();

