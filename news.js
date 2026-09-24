require('dotenv').config();

const ALPHA_TICKER_MAP = {
  'BTC/USD': 'CRYPTO:BTC', 'ETH/USD': 'CRYPTO:ETH', 'SOL/USD': 'CRYPTO:SOL', 'XRP/USD': 'CRYPTO:XRP',
  'XAU/USD': 'FOREX:XAU', 'EUR/USD': 'FOREX:EUR', 'GBP/USD': 'FOREX:GBP',
  'USD/JPY': 'FOREX:JPY', 'AUD/USD': 'FOREX:AUD', 'USD/CAD': 'FOREX:CAD',
};

// Marketaux uses plain search terms rather than ticker codes
const MARKETAUX_SEARCH_MAP = {
  'BTC/USD': 'bitcoin', 'ETH/USD': 'ethereum', 'SOL/USD': 'solana', 'XRP/USD': 'xrp',
  'XAU/USD': 'gold price', 'EUR/USD': 'euro dollar', 'GBP/USD': 'pound dollar',
  'USD/JPY': 'yen dollar', 'AUD/USD': 'australian dollar', 'USD/CAD': 'canadian dollar',
};

async function getFromAlphaVantage(symbol) {
  const ticker = ALPHA_TICKER_MAP[symbol];
  if (!ticker) return { available: false, message: `No Alpha Vantage ticker mapping for ${symbol}` };

  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=10&apikey=${process.env.ALPHAVANTAGE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.Note || data.Information) {
    throw new Error('RATE_LIMITED'); // signal to try the fallback provider
  }
  if (!data.feed || data.feed.length === 0) {
    return { available: false, message: 'No recent news found (Alpha Vantage)' };
  }

  let totalScore = 0, count = 0;
  const headlines = [];
  for (const article of data.feed.slice(0, 5)) {
    const tickerData = article.ticker_sentiment?.find(t => t.ticker === ticker.split(':')[1] || t.ticker === ticker);
    const score = tickerData ? parseFloat(tickerData.ticker_sentiment_score) : parseFloat(article.overall_sentiment_score);
    if (!isNaN(score)) { totalScore += score; count++; }
    headlines.push({ title: article.title, sentiment: article.overall_sentiment_label, time: article.time_published });
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  return buildResult(avgScore, count, headlines, 'Alpha Vantage');
}

async function getFromMarketaux(symbol) {
  const searchTerm = MARKETAUX_SEARCH_MAP[symbol];
  if (!searchTerm) return { available: false, message: `No Marketaux search mapping for ${symbol}` };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `https://api.marketaux.com/v1/news/all?search=${encodeURIComponent(searchTerm)}&published_after=${sevenDaysAgo}&language=en&limit=5&sort=published_desc&api_token=${process.env.MARKETAUX_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    return { available: false, message: `Marketaux error: ${data.error.message || 'unknown'}` };
  }
  if (!data.data || data.data.length === 0) {
    return { available: false, message: 'No recent news found (Marketaux)' };
  }

  let totalScore = 0, count = 0;
  const headlines = [];
  for (const article of data.data) {
    const entity = article.entities?.[0];
    const score = entity && entity.sentiment_score !== undefined ? parseFloat(entity.sentiment_score) : null;
    const hasValidScore = score !== null && !isNaN(score);

    if (hasValidScore) { totalScore += score; count++; }

    headlines.push({
      title: article.title,
      sentiment: hasValidScore ? (score > 0.1 ? 'Bullish' : score < -0.1 ? 'Bearish' : 'Neutral') : 'No score available',
      time: article.published_at,
    });
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  return buildResult(avgScore, count, headlines, 'Marketaux');
}

function buildResult(avgScore, count, headlines, source) {
  let label = 'Neutral';
  if (avgScore > 0.15) label = 'Bullish';
  if (avgScore > 0.35) label = 'Strongly Bullish';
  if (avgScore < -0.15) label = 'Bearish';
  if (avgScore < -0.35) label = 'Strongly Bearish';

  return {
    available: true,
    source,
    averageScore: avgScore.toFixed(3),
    label,
    articleCount: count,
    lowConfidence: count < 3, // fewer than 3 scored articles = thin sample, treat cautiously
    recentHeadlines: headlines.slice(0, 3),
  };
}

async function getNewsSentiment(symbol) {
  try {
    return await getFromAlphaVantage(symbol);
  } catch (err) {
    if (err.message === 'RATE_LIMITED') {
      console.log(`Alpha Vantage rate-limited for ${symbol}, falling back to Marketaux...`);
      try {
        return await getFromMarketaux(symbol);
      } catch (fallbackErr) {
        return { available: false, message: `Both news providers failed: ${fallbackErr.message}` };
      }
    }
    return { available: false, message: err.message };
  }
}

module.exports = { getNewsSentiment };
