require('dotenv').config();
const readline = require('readline');
const { analyzeAssetVoice, getTradeRecommendationVoice } = require('./brain');
const { startScheduler, runScan } = require('./scheduler');
const { getActiveMode, setActiveMode } = require('./modes');
const { listPending, approveLatest, rejectLatest } = require('./approvals');
const watchlist = require('./watchlist');

function findAsset(query) {
  const q = query.toLowerCase();
  return watchlist.find(a =>
    a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase().split('/')[0])
  );
}

async function handleCommand(input) {
  const text = input.toLowerCase().trim();

  if (text === 'pending' || text.includes('show pending')) {
    const pending = listPending();
    if (pending.length === 0) {
      console.log('No trades pending approval.');
    } else {
      console.log('\n--- Pending Approvals ---');
      pending.forEach(t => {
        console.log(`[${t.id}] ${t.name} ${t.direction} @ ${t.entry} | SL ${t.stop_loss} | TP ${t.take_profit} | ${t.ratio}`);
      });
    }
    return;
  }

  if (text.startsWith('approve')) {
    const target = text.replace('approve', '').trim();
    const result = approveLatest(target);
    console.log(result.success
      ? `Approved: ${result.trade.name} ${result.trade.direction} @ ${result.trade.entry}`
      : result.message);
    return;
  }

  if (text.startsWith('reject')) {
    const target = text.replace('reject', '').trim();
    const result = rejectLatest(target);
    console.log(result.success
      ? `Rejected: ${result.trade.name} ${result.trade.direction} @ ${result.trade.entry}`
      : result.message);
    return;
  }

  if (text.includes('scan') || text.includes('watchlist')) {
    console.log('Starting a manual scan of the full watchlist...');
    await runScan();
    return;
  }

  if (text.includes('mode')) {
    console.log('Available modes: pulse, focus, grind. Say "switch to pulse" etc.');
    const match = text.match(/(pulse|focus|grind)/);
    if (match) {
      setActiveMode(match[1]);
      console.log(`Switched to ${match[1]} mode.`);
    }
    return;
  }

  const asset = findAsset(text);
  if (!asset) {
    console.log('No matching asset found. Try an asset name, "scan", "pending", "approve/reject [asset]", or a mode name.');
    return;
  }

  console.log(`Matched: ${asset.name}`);

  if (text.includes('trade') || text.includes('entry') || text.includes('setup')) {
    await getTradeRecommendationVoice(asset.symbol, asset.name); // still works — speak() is now a silent no-op
  } else {
    await analyzeAssetVoice(asset.symbol, asset.name); // same here
  }
}

function startTextMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== Ren — Text Mode (voice disabled, dashboard is primary) ===');
  console.log('Commands: an asset name | "trade setup on [asset]" | "scan" | "pending" | "approve [asset]" | "reject [asset]" | "switch to [pulse/focus/grind]" | "exit"\n');

  const ask = () => {
    rl.question('> ', async (input) => {
      const text = input.trim().toLowerCase();

      if (text === 'exit') {
        rl.close();
        process.exit(0);
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

  startScheduler();
  startTextMenu();
}

main();
