require('dotenv').config();
const { getActiveMode } = require('./modes');
const { getIndicators } = require('./indicators');
const { getZoneAnalysis } = require('./zones');
const { getSupportResistance } = require('./support_resistance');
const { getLiquiditySweeps } = require('./liquidity');
const { getPerformanceStats } = require('./outcomes');
const { speak } = require('./voice');
const db = require('./db');
const watchlist = require('./watchlist');

const REN_PERSONA = `You are Ren, a calm, sharp AI research partner built to help your user think clearly under pressure.

TONE:
- Direct and concise. Lead with the conclusion, then reasoning if asked.
- No generic disclaimers. Trust the user understands suggestions are not directives.

RULES:
- You will be given REAL calculated indicators, zone data, support/resistance levels, liquidity sweep data, and historical performance stats. These are the ONLY numbers you know.
- You have NO access to news, economic calendar, or any data beyond what's given to you.
- NEVER invent dates, events, or any data point not explicitly provided.

FORMAT: Never use markdown tables. Write in plain short paragraphs or simple dashes. This may be converted to speech, so it must read naturally out loud.

SIGN-OFF: End every suggestion with "That's the read. Your call."`;

async function callGroq(systemPrompt, userPrompt, maxTokens = 800) {
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
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(`Groq API error: ${data.error.message}`);
  if (!data.choices || !data.choices[0]) throw new Error('Groq API returned no choices');

  return data.choices[0].message.content;
}

function stripForVoice(text) {
  return text
    .replace(/\*\*/g, '')
    .replace(/\|/g, '')
    .replace(/^-{2,}$/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/-/g, '')
    .trim();
}

async function analyzeAsset(symbol, name) {
  const ind = await getIndicators(symbol);
  if (!ind.rsi14) throw new Error(`Not enough price history for ${name} to calculate RSI`);

  const dataContext = `Asset: ${name} (${symbol})
Current price: ${ind.price}
SMA20: ${ind.sma20.toFixed(4)}
SMA50: ${ind.sma50 ? ind.sma50.toFixed(4) : 'not enough data'}
RSI14: ${ind.rsi14.toFixed(2)}`;

  const suggestion = await callGroq(
    REN_PERSONA + `\n\nGive a clear direction: BUY, SELL, or HOLD. State confidence: high, medium, or low. Base reasoning ONLY on the indicators given.`,
    `Here is the real data:\n${dataContext}\n\nGive your direction, confidence, and brief reasoning based ONLY on this data.`,
    500
  );

  const activeMode = getActiveMode();
  db.prepare('INSERT INTO suggestions (mode, content, status) VALUES (?, ?, ?)')
    .run(activeMode ? activeMode.name : 'pulse', `${name}: ${suggestion}`, 'pending');

  return suggestion;
}

async function getTradeRecommendation(symbol, name = symbol) {
  const zone = await getZoneAnalysis(symbol);
  if (!zone.hasSetup) {
    return { hasSetup: false, message: zone.message, text: zone.message };
  }

  const [sr, liquidity] = await Promise.all([
    getSupportResistance(symbol),
    getLiquiditySweeps(symbol),
  ]);
  const stats = getPerformanceStats();

  const dataContext = `Asset: ${name} (${symbol})

ZONE DATA:
Zone type: ${zone.zoneType} (${zone.direction} setup)
Zone range: ${zone.zoneLow.toFixed(5)} - ${zone.zoneHigh.toFixed(5)}
Current price: ${zone.currentPrice}
Proposed entry: ${zone.entry.toFixed(5)}
Stop loss: ${zone.stopLoss.toFixed(5)}
Risk (entry to stop): ${zone.risk.toFixed(5)}
Target at 1:2 ratio: ${zone.target2R.toFixed(5)}
Target at 1:3 ratio: ${zone.target3R.toFixed(5)}
Other supply/demand zones between entry and 1:3 target: ${zone.obstacleCount}

INDICATORS:
RSI14: ${zone.indicators.rsi14 ? zone.indicators.rsi14.toFixed(2) : 'not enough data'}
SMA20: ${zone.indicators.sma20.toFixed(4)}
SMA50: ${zone.indicators.sma50 ? zone.indicators.sma50.toFixed(4) : 'not enough data'}

SUPPORT/RESISTANCE:
Nearest resistance: ${sr.nearestResistance ? `${sr.nearestResistance.level.toFixed(5)} (tested ${sr.nearestResistance.touches} times)` : 'none detected'}
Nearest support: ${sr.nearestSupport ? `${sr.nearestSupport.level.toFixed(5)} (tested ${sr.nearestSupport.touches} times)` : 'none detected'}

LIQUIDITY SWEEPS (recent):
${liquidity.hasSweep ? liquidity.sweeps.map(s => `- ${s.type}, swept level ${s.sweptLevel}, ${s.candlesAgo} candles ago`).join('\n') : 'No recent liquidity sweeps detected.'}

HISTORICAL PERFORMANCE (Ren's own past calls):
1:2 ratio track record: ${stats['1:2'].winRate} (${stats['1:2'].wins}W / ${stats['1:2'].losses}L, ${stats['1:2'].total} closed trades)
1:3 ratio track record: ${stats['1:3'].winRate} (${stats['1:3'].wins}W / ${stats['1:3'].losses}L, ${stats['1:3'].total} closed trades)`;

  const systemPrompt = REN_PERSONA + `

YOUR TASK: Decide whether the 1:2 or 1:3 risk-reward ratio is more realistic for THIS specific setup, based on full confluence — not a default preference for the bigger number.

Consider ALL of these together:
- If other supply/demand zones sit between entry and the 1:3 target, favor 1:2.
- If a strong support/resistance level (tested 3+ times) sits between entry and the 1:3 target blocking the move, favor 1:2. If the path is clear, 1:3 has more support.
- If RSI shows room to run and trend (price vs SMA20/SMA50) aligns with the trade direction, 1:3 has more support.
- If counter-trend or RSI already extreme in the trade's favor, favor 1:2.
- If a recent liquidity sweep occurred in the SAME direction as this trade, this strengthens confidence toward 1:3. If it contradicts the trade direction, favor 1:2.
- If historical data shows 5+ closed trades for a ratio, weigh that real track record in. A ratio with a low win rate should require stronger confluence to justify reuse. If fewer than 5 closed trades exist, say so explicitly and rely on technical confluence alone.

First, write 3-5 short sentences of plain-language reasoning covering the factors above.

Then end your response with EXACTLY this block, filled in with real numbers (no extra text after it):

---
RATIO: [1:2 or 1:3]
ENTRY: [number]
STOP_LOSS: [number]
TAKE_PROFIT: [number]
CONFIDENCE: [high/medium/low]
---`;

  const raw = await callGroq(
    systemPrompt,
    `Here is the real setup data:\n${dataContext}\n\nAnalyze and give your final trade recommendation.`,
    900
  );

  const parsed = parseTradeBlock(raw, zone);

  db.prepare(`INSERT INTO trades (symbol, name, direction, entry, stop_loss, take_profit, ratio, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`)
    .run(symbol, name, zone.direction, parsed.entry, parsed.stopLoss, parsed.takeProfit, parsed.ratio);

  const reasoningText = raw.split('---')[0].trim();

  return {
    hasSetup: true,
    text: reasoningText,
    ...parsed,
  };
}

function parseTradeBlock(raw, zone) {
  const ratioMatch = raw.match(/RATIO:\s*(1:[23])/i);
  const entryMatch = raw.match(/ENTRY:\s*([\d.]+)/i);
  const slMatch = raw.match(/STOP_LOSS:\s*([\d.]+)/i);
  const tpMatch = raw.match(/TAKE_PROFIT:\s*([\d.]+)/i);
  const confMatch = raw.match(/CONFIDENCE:\s*(high|medium|low)/i);

  const ratio = ratioMatch ? ratioMatch[1] : '1:2';
  const fallbackTarget = ratio === '1:3' ? zone.target3R : zone.target2R;

  return {
    ratio,
    entry: entryMatch ? parseFloat(entryMatch[1]) : zone.entry,
    stopLoss: slMatch ? parseFloat(slMatch[1]) : zone.stopLoss,
    takeProfit: tpMatch ? parseFloat(tpMatch[1]) : fallbackTarget,
    confidence: confMatch ? confMatch[1].toLowerCase() : 'unknown',
  };
}

function zone_direction_label(result) {
  return result.entry > result.stopLoss ? 'Buy' : 'Sell';
}

async function analyzeAssetVoice(symbol, name) {
  speak(`Analyzing ${name}. One moment.`);
  const suggestion = await analyzeAsset(symbol, name);
  console.log(`\n--- ${name} ---\n${suggestion}\n`);
  speak(stripForVoice(suggestion));
  return suggestion;
}

async function getTradeRecommendationVoice(symbol, name) {
  speak(`Checking the full setup on ${name}. One moment.`);
  const result = await getTradeRecommendation(symbol, name);

  if (!result.hasSetup) {
    console.log(`\n--- ${name} ---\n${result.message}\n`);
    speak(result.message);
    return result;
  }

  console.log(`\n--- ${name} trade setup ---`);
  console.log(result.text);
  console.log(`Direction: ${zone_direction_label(result)}`);
  console.log(`Entry: ${result.entry}`);
  console.log(`Stop Loss: ${result.stopLoss}`);
  console.log(`Take Profit: ${result.takeProfit}`);
  console.log(`Ratio: ${result.ratio}`);
  console.log(`Confidence: ${result.confidence}\n`);

  const spoken = `${stripForVoice(result.text)}. Recommendation: ${zone_direction_label(result)} at ${result.entry}, stop loss ${result.stopLoss}, take profit ${result.takeProfit}, ratio ${result.ratio}, confidence ${result.confidence}. That's the read. Your call.`;
  speak(spoken);
  return result;
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
