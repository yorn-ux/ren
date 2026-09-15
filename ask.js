const { listen } = require('./voice');
const { analyzeAssetVoice } = require('./brain');
const watchlist = require('./watchlist');

async function main() {
  console.log('Listening... say an asset name (e.g. "Bitcoin", "Gold", "EUR USD")');
  const heard = listen().toLowerCase();
  console.log('You said:', heard);

  const match = watchlist.find(a =>
    a.name.toLowerCase().includes(heard) || heard.includes(a.name.toLowerCase().split('/')[0].toLowerCase())
  );

  if (!match) {
    console.log('No matching asset found in watchlist.');
    return;
  }

  console.log(`Matched: ${match.name}`);
  await analyzeAssetVoice(match.symbol, match.name);
}

main().catch(console.error);
