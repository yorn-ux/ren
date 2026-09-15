require('dotenv').config();
const { getActiveMode } = require('./modes');
const { getIndicators } = require('./indicators');
const { getZoneAnalysis } = require('./zones');
const { speak } = require('./voice');
const db = require('./db');
const watchlist = require('./watchlist');

const REN_PERSONA = `You are Ren, a calm, sharp AI research partner built to help your user think clearly under pressure.

TONE:
- Direct and concise. Lead with the conclusion, then reasoning if asked.
- No generic disclaimers. Trust the user understands suggestions are not directives.

RULES:
- You will be given REAL calculated indicators and zone data. These are the ONLY numbers you know.
- You have NO access to news, economic calendar, or any data beyond what's given to you.
- NEVER invent dates, events, or any data point not explicitly provided.

SIGN-OFF: End every suggestion with "That's the read. Your call."`;

async function callGroq(systemPrompt, userPrompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 600,
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// Basic directional analysis (existing feature, unchanged)
async function analyzeAsset(symbol, name) {
  const ind = await getIndicators(symbol);
  const dataContext = `Asset: ${name} (${symbol})
Current price: ${ind.price}
SMA20: ${ind.sma20.toFixed(4)}
SMA50: ${ind.sma50 ? ind.sma50.toFixed(4) : 'not enough data'}
RSI14: ${ind.rsi14.toFixed(2)}`;

  const suggestion = await callGroq(
    REN_PERSONA + `\n\nGive a clear direction: BUY, SELL, or HOLD. State confidence: high, medium, or low. Base reasoning ONLY on the indicators given.`,
    `Here is the real data:\n${dataContext}\n\nGive your direction, confidence, and brief reasoning based ONLY on this data.`
  );

  const activeMode = getActiveMode();
  db.prepare('INSERT INTO suggestions (mode, content, status) VALUES (?, ?, ?)')
    .run(activeMode ? activeMode.name : 'pulse', `${name}: ${suggestion}`, 'pending');

  return suggestion;
}

// NEW: full trade plan with Ren judging the best ratio based on confluence
async function getTradeRecommendation(symbol, name = symbol) {
  const zone = await getZoneAnalysis(symbol);

  if (!zone.hasSetup) {
    return zone.message;
  }

  const dataContext = `Asset: ${name} (${symbol})
Zone type: ${zone.zoneType} (${zone.direction} setup)
Zone range: ${zone.zoneLow.toFixed(5)} - ${zone.zoneHigh.toFixed(5)}
Current price: ${zone.currentPrice}
Proposed entry: ${zone.entry.toFixed(5)}
Stop loss: ${zone.stopLoss.toFixed(5)}
Risk (entry to stop): ${zone.risk.toFixed(5)}
Target at 1:2 ratio: ${zone.target2R.toFixed(5)}
Target at 1:3 ratio: ${zone.target3R.toFixed(5)}
Other supply/demand zones sitting between entry and the 1:3 target: ${zone.obstacleCount}
RSI14: ${zone.indicators.rsi14.toFixed(2)}
SMA20: ${zone.indicators.sma20.toFixed(4)}
SMA50: ${zone.indicators.sma50 ? zone.indicators.sma50.toFixed(4) : 'not enough data'}`;

  const systemPrompt = REN_PERSONA + `

YOUR TASK: Decide whether the 1:2 or 1:3 risk-reward ratio is more realistic for THIS specific setup, based on confluence — not a default preference for the bigger number.

Consider:
- If other zones sit between entry and the 1:3 target, price likely reacts there first — favor 1:2.
- If RSI shows room to run (not already exhausted in the trade direction) and trend (price vs SMA20/SMA50) aligns with the trade direction, 1:3 has more support.
- If the trade is counter-trend or RSI is already extreme in the trade's favor, favor 1:2 as the safer, more probable target.

Give:
1. Your chosen ratio (1:2 or 1:3) and why, in 2-3 sentences
2. Final entry, stop loss, and take profit numbers
3. Confidence: high, medium, or low`;

  const recommendation = await callGroq(systemPrompt, `Here is the real setup data:\n${dataContext}\n\nAnalyze and give your final trade recommendation.`);

  // Log which ratio Ren actually chose by checking its response text
  const chosenRatio = recommendation.includes('1:3') && !recommendation.includes('1:2 ratio is more realistic') ? '1:3' : '1:2';
  const finalTarget = chosenRatio === '1:3' ? zone.target3R : zone.target2R;

  db.prepare(`INSERT INTO trades (symbol, name, direction, entry, stop_loss, take_profit, ratio, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`)
    .run(symbol, name, zone.direction, zone.entry, zone.stopLoss, finalTarget, chosenRatio);

  return recommendation;
}

async function analyzeAssetVoice(symbol, name) {
  speak(`Analyzing ${name}. One moment.`);
  const suggestion = await analyzeAsset(symbol, name);
  const spokenText = suggestion.replace(/\*\*/g, '').replace(/\n+/g, '. ').replace(/-/g, '');
  speak(spokenText);
  return suggestion;
}

async function getTradeRecommendationVoice(symbol, name) {
  speak(`Checking the setup on ${name}. One moment.`);
  const recommendation = await getTradeRecommendation(symbol, name);
  const spokenText = recommendation.replace(/\*\*/g, '').replace(/\n+/g, '. ').replace(/-/g, '');
  speak(spokenText);
  return recommendation;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeWatchlist() {
  const results = [];
  for (const asset of watchlist) {
    try {
      console.log(`Analyzing ${asset.name}...`);
      const suggestion = await analyzeAsset(asset.symbol, asset.name);
      results.push({ name: asset.name, suggestion });
    } catch (err) {
      console.log(`Failed on ${asset.name}: ${err.message}`);
      results.push({ name: asset.name, error: err.message });
    }
    await delay(8000);
  }
  return results;
}

module.exports = {
  analyzeAsset,
  analyzeWatchlist,
  analyzeAssetVoice,
  getTradeRecommendation,
  getTradeRecommendationVoice,
};
