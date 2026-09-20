require('dotenv').config();
const { getActiveMode } = require('./modes');
const { getIndicators } = require('./indicators');
const { getZoneAnalysis } = require('./zones');
const { getSupportResistance } = require('./support_resistance');
const { getLiquiditySweeps } = require('./liquidity');
const { getPerformanceStats } = require('./outcomes');
const { getCRTSetup } = require('./crt');
const { getNewsSentiment } = require('./news');
const { speak } = require('./voice');
const db = require('./db');
const watchlist = require('./watchlist');

const REN_PERSONA = `You are Ren, a calm, sharp AI research partner built to help your user think clearly under pressure.

TONE:
- Direct and concise. Lead with the conclusion, then reasoning if asked.
- No generic disclaimers. Trust the user understands suggestions are not directives.

RULES:
- You will be given REAL calculated indicators, zone data, support/resistance levels, liquidity sweep data, CRT/Turtle Soup data, historical performance stats, existing position data, and sometimes real news sentiment. These are the ONLY facts you know.
- You have NO access to anything beyond what's given to you.
- NEVER invent dates, events, headlines, or any data point not explicitly provided.

FORMAT: Never use markdown tables. Write in plain short paragraphs or simple dashes. This may be converted to speech, so it must read naturally out loud.

SIGN-OFF: End every suggestion with "That's the read. Your call."`;

const AUTO_APPROVE_MIN_TRADES = 5;
const AUTO_APPROVE_MIN_WINRATE = 60;
const ACTIVE_STATUSES = ['pending_approval', 'approved', 'open'];

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

// Check if there's already an active trade on this asset, and how it's doing
function getExistingPosition(symbol, currentPrice) {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  const existing = db.prepare(
    `SELECT * FROM trades WHERE symbol = ? AND status IN (${placeholders}) ORDER BY id DESC LIMIT 1`
  ).get(symbol, ...ACTIVE_STATUSES);

  if (!existing) return null;

  const entry = Number(existing.entry);
  const sl = Number(existing.stop_loss);
  const tp = Number(existing.take_profit);
  const isBuy = existing.direction === 'BUY';

  // How far price has moved from entry toward target vs toward stop, as a rough progress %
  const totalDistanceToTP = Math.abs(tp - entry);
  const movedTowardTP = isBuy ? (currentPrice - entry) : (entry - currentPrice);
  const progressPercent = totalDistanceToTP > 0
    ? Math.round((movedTowardTP / totalDistanceToTP) * 100)
    : 0;

  return {
    id: existing.id,
    direction: existing.direction,
    entry,
    stopLoss: sl,
    takeProfit: tp,
    ratio: existing.ratio,
    status: existing.status,
    createdAt: existing.created_at,
    progressPercent, // negative = moving toward stop loss, positive = moving toward target
  };
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

function decideStatus(ratio, confidence, stats) {
  if (confidence !== 'high') return 'pending_approval';

  const ratioStats = stats[ratio];
  if (!ratioStats || ratioStats.total < AUTO_APPROVE_MIN_TRADES) return 'pending_approval';

  const winRateNum = parseFloat(ratioStats.winRate);
  if (isNaN(winRateNum) || winRateNum < AUTO_APPROVE_MIN_WINRATE) return 'pending_approval';

  return 'approved';
}

async function getTradeRecommendation(symbol, name = symbol, includeNews = false) {
  const zone = await getZoneAnalysis(symbol);
  if (!zone.hasSetup) {
    return { hasSetup: false, message: zone.message, text: zone.message };
  }

  const [sr, liquidity] = await Promise.all([
    getSupportResistance(symbol),
    getLiquiditySweeps(symbol),
  ]);
  const stats = getPerformanceStats();
  const crt = await getCRTSetup(symbol, name).catch(() => ({ hasSetup: false }));
  const existingPosition = getExistingPosition(symbol, zone.currentPrice);

  let news = { available: false, message: 'News check skipped for this request.' };
  if (includeNews) {
    news = await getNewsSentiment(symbol).catch(err => ({ available: false, message: err.message }));
  }

  const existingPositionText = existingPosition
    ? `You already have a ${existingPosition.status.replace('_', ' ')} ${existingPosition.direction} trade on this asset from ${existingPosition.createdAt}. Entry: ${existingPosition.entry}, Stop Loss: ${existingPosition.stopLoss}, Take Profit: ${existingPosition.takeProfit}, Ratio: ${existingPosition.ratio}. Current progress: ${existingPosition.progressPercent}% of the way from entry toward target (negative means it has moved toward the stop loss instead).`
    : 'No existing active trade on this asset currently.';

  const dataContext = `Asset: ${name} (${symbol})

EXISTING POSITION:
${existingPositionText}

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
1:3 ratio track record: ${stats['1:3'].winRate} (${stats['1:3'].wins}W / ${stats['1:3'].losses}L, ${stats['1:3'].total} closed trades)

CRT / TURTLE SOUP (daily range sweep + reversal):
${crt.hasSetup
    ? `${crt.direction} setup detected. Daily range: ${crt.dailyRange.low.toFixed(5)} - ${crt.dailyRange.high.toFixed(5)}. Sweep type: ${crt.sweep.type}, swept level ${crt.sweep.sweptLevel.toFixed(5)}, ${crt.sweep.candlesAgo} candles ago. Market Structure Shift confirmed: ${crt.mssConfirmed ? 'YES' : 'NOT YET'} (${crt.mssReason}).`
    : 'No CRT/Turtle Soup setup currently detected.'}

NEWS SENTIMENT:
${news.available
    ? `Overall sentiment: ${news.label} (score ${news.averageScore}, based on ${news.articleCount} recent articles). Recent headlines: ${news.recentHeadlines.map(h => h.title).join(' | ')}`
    : `Not available for this request (${news.message}). Reason from technicals only — do not guess at news you don't have.`}`;

  const systemPrompt = REN_PERSONA + `

YOUR TASK: Decide whether the 1:2 or 1:3 risk-reward ratio is more realistic for THIS specific setup, based on full confluence — not a default preference for the bigger number.

CRITICAL FIRST CHECK — Existing Position:
If there is already an existing active trade on this asset, address this FIRST, before anything else: state clearly whether the user should WAIT for the existing trade to play out, or whether this NEW setup is compelling enough to consider alongside/instead of it. Consider: is the existing trade already near its target (let it run) or near its stop (risky to add exposure)? Does the new setup agree with or contradict the existing trade's direction? Opening two trades in the same direction on the same asset doubles risk exposure; opening opposite directions creates a conflicting position. Be direct about this — it's the most important practical question before any new numbers matter.

Then consider ALL of these for the ratio decision:
- If other supply/demand zones sit between entry and the 1:3 target, favor 1:2.
- If a strong support/resistance level (tested 3+ times) sits between entry and the 1:3 target blocking the move, favor 1:2. If the path is clear, 1:3 has more support.
- If RSI shows room to run and trend (price vs SMA20/SMA50) aligns with the trade direction, 1:3 has more support.
- If counter-trend or RSI already extreme in the trade's favor, favor 1:2.
- If a recent liquidity sweep occurred in the SAME direction as this trade, this strengthens confidence toward 1:3. If it contradicts the trade direction, favor 1:2.
- If historical data shows 5+ closed trades for a ratio, weigh that real track record in. A ratio with a low win rate should require stronger confluence to justify reuse. If fewer than 5 closed trades exist, say so explicitly and rely on technical confluence alone.
- If a CRT/Turtle Soup setup is detected AND its direction matches this trade's direction, this is a strong named-strategy confluence signal — especially if MSS is confirmed. This should push toward higher confidence. If MSS is not yet confirmed, weight it less.
- If news sentiment is available and STRONGLY contradicts this trade's direction, reduce confidence and favor 1:2 regardless of technicals. If news aligns, it supports higher confidence and 1:3. If unavailable, rely on technicals alone.

First, write 4-6 short sentences of plain-language reasoning: start with the existing-position guidance if one exists, then cover the other factors above.

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
    1100
  );

  const parsed = parseTradeBlock(raw, zone);
  const status = decideStatus(parsed.ratio, parsed.confidence, stats);

  db.prepare(`INSERT INTO trades (symbol, name, direction, entry, stop_loss, take_profit, ratio, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(symbol, name, zone.direction, parsed.entry, parsed.stopLoss, parsed.takeProfit, parsed.ratio, status);

  const reasoningText = raw.split('---')[0].trim();

  return {
    hasSetup: true,
    text: reasoningText,
    status,
    crt,
    news,
    existingPosition,
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
  speak(`Checking the full setup on ${name}, including any existing position. One moment.`);
  const result = await getTradeRecommendation(symbol, name, true);

  if (!result.hasSetup) {
    console.log(`\n--- ${name} ---\n${result.message}\n`);
    speak(result.message);
    return result;
  }

  const statusLabel = result.status === 'approved' ? 'AUTO-APPROVED (proven track record)' : 'PENDING YOUR APPROVAL';

  console.log(`\n--- ${name} trade setup [${statusLabel}] ---`);
  if (result.existingPosition) {
    console.log(`Existing position: ${result.existingPosition.direction} from ${result.existingPosition.createdAt}, progress ${result.existingPosition.progressPercent}%`);
  }
  console.log(result.text);
  console.log(`Direction: ${zone_direction_label(result)}`);
  console.log(`Entry: ${result.entry}`);
  console.log(`Stop Loss: ${result.stopLoss}`);
  console.log(`Take Profit: ${result.takeProfit}`);
  console.log(`Ratio: ${result.ratio}`);
  console.log(`Confidence: ${result.confidence}`);
  if (result.crt && result.crt.hasSetup) {
    console.log(`CRT/Turtle Soup: ${result.crt.direction} sweep, MSS ${result.crt.mssConfirmed ? 'confirmed' : 'not yet confirmed'}`);
  }
  if (result.news && result.news.available) {
    console.log(`News sentiment: ${result.news.label} (${result.news.averageScore})`);
  }
  console.log('');

  const approvalNote = result.status === 'approved'
    ? 'This one auto-approved based on a proven track record.'
    : 'This one needs your approval before I track it as a live trade.';

  const spoken = `${stripForVoice(result.text)}. Recommendation: ${zone_direction_label(result)} at ${result.entry}, stop loss ${result.stopLoss}, take profit ${result.takeProfit}, ratio ${result.ratio}, confidence ${result.confidence}. ${approvalNote} That's the read. Your call.`;
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
