require('dotenv').config();
const { getActiveMode } = require('./modes');
const { evaluateStrategies } = require('./strategies');
const { getSupportResistance } = require('./support_resistance');
const { getLiquiditySweeps } = require('./liquidity');
const { getPerformanceStats } = require('./outcomes');
const { getNewsSentiment } = require('./news');
const { calculatePositionSize } = require('./positionSize');
const { isMarketOpenFor } = require('./marketHours');
const { speak } = require('./voice');
const db = require('./db');
const watchlist = require('./watchlist');

const REN_PERSONA = `You are Ren, a calm, sharp AI research partner built to help your user think clearly under pressure.

TONE:
- Direct and concise. Lead with the conclusion, then reasoning if asked.
- No generic disclaimers. Trust the user understands suggestions are not directives.

RULES:
- You will be given REAL calculated data about which trading strategies confirmed this setup, support/resistance, liquidity sweeps, historical performance, existing position data, and sometimes real news sentiment. These are the ONLY facts you know.
- You have NO access to anything beyond what's given to you.
- NEVER invent dates, events, headlines, or any data point not explicitly provided.

FORMAT: Never use markdown tables. Write in plain short paragraphs or simple dashes. This may be converted to speech, so it must read naturally out loud.

SIGN-OFF: End every suggestion with "That's the read. Your call."`;

const AUTO_APPROVE_MIN_TRADES = 5;
const AUTO_APPROVE_MIN_WINRATE = 60;
const ACTIVE_STATUSES = ['pending_approval', 'approved', 'open'];

// --- Expire stale pending trades on a specific symbol --------------------
// Called before the duplicate check. A pending trade is stale if:
//  - price already hit its stop, or
//  - price already ran past 40% of the way to target
// When stale, mark it 'expired' so it stops blocking fresh analysis.
const STALE_MISSED_MOVE_PCT = 40;

function expireStalePendingForSymbol(symbol, mode) {
  const pending = db.prepare(
    "SELECT * FROM trades WHERE status = 'pending_approval' AND symbol = ? AND mode = ?"
  ).all(symbol, mode);

  const expired = [];

  for (const p of pending) {
    const entry = Number(p.entry);
    const sl = Number(p.stop_loss);
    const tp = Number(p.take_profit);
    if (!entry || !sl || !tp) continue;

    const isBuy = p.direction === 'BUY';
    const reward = Math.abs(tp - entry);
    const progressPct = isBuy
      ? (p.currentPrice ?? 0) // placeholder — real check happens below
      : 0;

    // We don't have current price here — that's the caller's job to provide.
    // This function is called from getTradeRecommendation with price already
    // computed from evaluateStrategies.
  }

  return expired;
}

// Proper version that takes current price as argument
function expireStalePendingWithPrice(symbol, mode, currentPrice) {
  const pending = db.prepare(
    "SELECT * FROM trades WHERE status = 'pending_approval' AND symbol = ? AND mode = ?"
  ).all(symbol, mode);

  const expired = [];

  for (const p of pending) {
    const entry = Number(p.entry);
    const sl = Number(p.stop_loss);
    const tp = Number(p.take_profit);
    if (!entry || !sl || !tp || !currentPrice) continue;

    const isBuy = p.direction === 'BUY';
    const reward = Math.abs(tp - entry);
    const progressPct = isBuy
      ? (currentPrice - entry) / reward * 100
      : (entry - currentPrice) / reward * 100;

    const slHit = isBuy ? currentPrice <= sl : currentPrice >= sl;
    const missedMove = progressPct >= STALE_MISSED_MOVE_PCT;
    const blownThrough = isBuy ? currentPrice >= tp : currentPrice <= tp;

    let reason = null;
    if (slHit) reason = 'stopped_out';
    else if (blownThrough) reason = 'blown_through';
    else if (missedMove) reason = `missed_move_${Math.round(progressPct)}pct`;

    if (reason) {
      db.prepare(
        "UPDATE trades SET status = 'expired', closed_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(p.id);

      expired.push({
        id: p.id,
        name: p.name,
        direction: p.direction,
        entry,
        price: currentPrice,
        reason,
        progressPct: Math.round(progressPct),
      });
    }
  }

  return expired;
}

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
    progressPercent,
  };
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
  if (!isMarketOpenFor(symbol)) {
    return {
      hasSetup: false,
      marketClosed: true,
      message: `${name} market is currently closed (weekend closure). No analysis run.`,
      text: `${name}'s market is closed right now. Check back after it reopens.`,
    };
  }

  // Run strategies (now includes freshness gate — will return hasSetup:false
  // if entry is too far, price already passed entry, or move is mostly gone)
  const strat = await evaluateStrategies(symbol, name);

  // Even if strategies fired, if the setup is stale, refuse it
  if (!strat.hasSetup) {
    return {
      hasSetup: false,
      stale: strat.stale || null,
      message: strat.message,
      text: strat.message,
    };
  }

  // --- Expire stale pending trades on this symbol BEFORE duplicate check ---
  // Otherwise a dead setup blocks a fresh one from ever being shown.
  const modeName = (getActiveMode() || { name: 'pulse' }).name.toLowerCase();
  const expired = expireStalePendingWithPrice(symbol, modeName, strat.indicators.price);
  if (expired.length > 0) {
    console.log(`Auto-expired ${expired.length} stale pending on ${name}:`,
      expired.map(e => `${e.direction} entry ${e.entry} (${e.reason})`).join(', '));
  }

  // Now check for duplicates — but only count *live* (non-expired) trades
  const existingSameDirection = getExistingPosition(symbol, strat.indicators.price);

  if (existingSameDirection && existingSameDirection.direction === strat.direction) {
    return {
      hasSetup: false,
      duplicateBlocked: true,
      existingPosition: existingSameDirection,
      message: `Already have an active ${existingSameDirection.direction} trade on ${name} (entry ${existingSameDirection.entry}, ${existingSameDirection.progressPercent}% toward target). Skipping duplicate.`,
      text: `Already tracking a ${existingSameDirection.direction} trade on ${name}, currently ${existingSameDirection.progressPercent}% of the way to target. Not logging a duplicate.`,
    };
  }

  const [sr, liquidity] = await Promise.all([
    getSupportResistance(symbol),
    getLiquiditySweeps(symbol),
  ]);
  const stats = getPerformanceStats();

  let news = { available: false, message: 'News check skipped for this request.' };
  if (includeNews) {
    news = await getNewsSentiment(symbol).catch(err => ({ available: false, message: err.message }));
  }

  const existingPositionText = existingSameDirection
    ? `You already have a ${existingSameDirection.direction} trade on this asset, opposite direction to this new setup — potential reversal signal.`
    : 'No existing active trade on this asset.';

  const newsText = news.available
    ? `Overall sentiment: ${news.label} (score ${news.averageScore}, ${news.articleCount} scored articles).${news.lowConfidence ? ' LOW CONFIDENCE sample — do not weight heavily.' : ''}`
    : `Not available (${news.message}). Reason from technicals only.`;

  const fresh = strat.freshness || {};
  const freshnessLine = fresh.fresh
    ? `Entry is ${fresh.distancePct?.toFixed(2)}% from current price. Price is ${fresh.progressPct?.toFixed(0)}% of the way to target (or ${Math.abs(fresh.progressPct || 0).toFixed(0)}% away if negative).`
    : 'Setup flagged as stale by strategy layer.';

  const dataContext = `Asset: ${name} (${symbol})

STRATEGIES CONFIRMED (${strat.strategyCount}/4, grade ${strat.grade}):
${strat.strategiesUsed.join(', ')}

FRESHNESS:
${freshnessLine}
Current price: ${strat.indicators.price}

EXISTING POSITION: ${existingPositionText}

Direction: ${strat.direction}
Entry: ${strat.entry.toFixed(5)}
Stop Loss: ${strat.stopLoss.toFixed(5)}
Target at 1:2: ${strat.target2R.toFixed(5)}
Target at 1:3: ${strat.target3R.toFixed(5)}

RSI14: ${strat.indicators.rsi14.toFixed(2)}
SMA20: ${strat.indicators.sma20.toFixed(4)}
SMA50: ${strat.indicators.sma50.toFixed(4)}

SUPPORT/RESISTANCE:
Nearest resistance: ${sr.nearestResistance ? sr.nearestResistance.level.toFixed(5) + ` (tested ${sr.nearestResistance.touches}x)` : 'none'}
Nearest support: ${sr.nearestSupport ? sr.nearestSupport.level.toFixed(5) + ` (tested ${sr.nearestSupport.touches}x)` : 'none'}

LIQUIDITY SWEEPS: ${liquidity.hasSweep ? liquidity.sweeps.map(s => s.type).join(', ') : 'none recent'}

HISTORICAL PERFORMANCE: 1:2 ${stats['1:2'].winRate} (${stats['1:2'].total} trades), 1:3 ${stats['1:3'].winRate} (${stats['1:3'].total} trades)

NEWS: ${newsText}`;

  const systemPrompt = REN_PERSONA + `

This setup already passed the mandatory trend gate AND at least one independent strategy (zone, failed-zone, FVG, or CRT+TBS), AND passed the freshness gate (entry is reachable and the move hasn't already happened). State clearly WHICH strategies confirmed it. If all 4 confirmed, call it an "A+ setup" explicitly.

Decide 1:2 or 1:3 ratio based on: obstacles to target, support/resistance in the path, liquidity sweep alignment, historical ratio performance, and news (only if not low-confidence).

Write 4-6 sentences naming the confirming strategies first, then the ratio reasoning. Reference the freshness line to confirm this entry is actionable now.

Then end with EXACTLY:
---
RATIO: [1:2 or 1:3]
CONFIDENCE: [high/medium/low]
---`;

  const raw = await callGroq(systemPrompt, `Data:\n${dataContext}\n\nGive your recommendation.`, 1000);

  const ratioMatch = raw.match(/RATIO:\s*(1:[23])/i);
  const confMatch = raw.match(/CONFIDENCE:\s*(high|medium|low)/i);
  const ratio = ratioMatch ? ratioMatch[1] : '1:2';
  const confidence = confMatch ? confMatch[1].toLowerCase() : 'unknown';
  const takeProfit = ratio === '1:3' ? strat.target3R : strat.target2R;

  const status = decideStatus(ratio, confidence, stats);
  const positionSize = calculatePositionSize(strat.entry, strat.stopLoss, symbol);

  db.prepare(`INSERT INTO trades (symbol, name, direction, entry, stop_loss, take_profit, ratio, status, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(symbol, name, strat.direction, strat.entry, strat.stopLoss, takeProfit, ratio, status, modeName);

  const reasoningText = raw.split('---')[0].trim();

  return {
    hasSetup: true,
    text: reasoningText,
    status,
    grade: strat.grade,
    strategiesUsed: strat.strategiesUsed,
    news,
    existingPosition: existingSameDirection,
    positionSize,
    freshness: fresh,
    direction: strat.direction,
    entry: strat.entry,
    stopLoss: strat.stopLoss,
    takeProfit,
    ratio,
    confidence,
  };
}

async function analyzeAssetVoice(symbol, name) {
  speak(`Analyzing ${name}. One moment.`);
  const result = await getTradeRecommendation(symbol, name, true);
  const text = result.text || result.message;
  console.log(`\n--- ${name} ---\n${text}\n`);
  speak(stripForVoice(text));
  return text;
}

async function getTradeRecommendationVoice(symbol, name) {
  speak(`Checking ${name}. One moment.`);
  const result = await getTradeRecommendation(symbol, name, true);

  if (!result.hasSetup) {
    console.log(`\n--- ${name} ---\n${result.message}\n`);
    speak(result.message);
    return result;
  }

  console.log(`\n--- ${name} [${result.grade} setup — ${result.status}] ---`);
  console.log(`Strategies: ${result.strategiesUsed.join(', ')}`);
  console.log(result.text);
  console.log(`${result.direction} @ ${result.entry} | SL ${result.stopLoss} | TP ${result.takeProfit} | ${result.ratio} | ${result.confidence}`);
  if (result.positionSize && !result.positionSize.error) {
    console.log(`Size: ${result.positionSize.isForex ? result.positionSize.lots + ' lots' : result.positionSize.units + ' units'} (risk $${result.positionSize.riskAmount})`);
  }
  console.log('');

  const spoken = `${result.grade} setup, confirmed by ${result.strategiesUsed.join(' and ')}. ${stripForVoice(result.text)}. ${result.direction} at ${result.entry}, stop ${result.stopLoss}, target ${result.takeProfit}, ratio ${result.ratio}. That's the read. Your call.`;
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
      const result = await getTradeRecommendation(asset.symbol, asset.name);
      results.push({ name: asset.name, result });
    } catch (err) {
      console.log(`Failed on ${asset.name}: ${err.message}`);
      results.push({ name: asset.name, error: err.message });
    }
    await delay(8000);
  }
  return results;
}

module.exports = {
  analyzeAssetVoice,
  analyzeWatchlist,
  getTradeRecommendation,
  getTradeRecommendationVoice,
  expireStalePendingWithPrice,
};
