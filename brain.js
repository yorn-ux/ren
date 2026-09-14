require('dotenv').config();
const { getActiveMode } = require('./modes');
const { getIndicators } = require('./indicators');
const db = require('./db');
const watchlist = require('./watchlist');

const REN_PERSONA = `You are Ren, a calm, sharp AI research partner built to help your user think clearly under pressure.

TONE:
- Direct and concise. Lead with the conclusion, then reasoning if asked.
- No generic disclaimers. Trust the user understands suggestions are not directives.

RULES:
- You will be given REAL calculated indicators (price, SMA20, SMA50, RSI14). These are the ONLY numbers you know.
- You have NO access to news, economic calendar, or any data beyond what's given to you.
- NEVER invent dates, events, central bank statements, or any other data point not explicitly provided.
- Give a clear direction: BUY, SELL, or HOLD.
- State a confidence level: high, medium, or low.
- Base your reasoning ONLY on the indicators given (price vs SMA20/SMA50 trend, RSI overbought >70 / oversold <30).

SIGN-OFF: End every suggestion with "That's the read. Your call."`;

async function analyzeAsset(symbol, name) {
  const ind = await getIndicators(symbol);

  const dataContext = `Asset: ${name} (${symbol})
Current price: ${ind.price}
SMA20: ${ind.sma20.toFixed(4)}
SMA50: ${ind.sma50 ? ind.sma50.toFixed(4) : 'not enough data'}
RSI14: ${ind.rsi14.toFixed(2)}`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: REN_PERSONA },
        { role: 'user', content: `Here is the real data:\n${dataContext}\n\nGive your direction (BUY/SELL/HOLD), confidence, and brief reasoning based ONLY on this data.` },
      ],
      max_tokens: 500,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const suggestion = data.choices[0].message.content;

  const activeMode = getActiveMode();
  db.prepare('INSERT INTO suggestions (mode, content, status) VALUES (?, ?, ?)')
    .run(activeMode ? activeMode.name : 'pulse', `${name}: ${suggestion}`, 'pending');

  return suggestion;
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
    await delay(8000); // wait 8 seconds between calls to respect free-tier rate limits
  }
  return results;
}

module.exports = { analyzeAsset, analyzeWatchlist };
