require('dotenv').config();

// Alpha Vantage uses specific ticker formats. Map our watchlist symbols to
// what their News Sentiment API understands.
const TICKER_MAP = {
  'BTC/USD': 'CRYPTO:BTC',
  'ETH/USD': 'CRYPTO:ETH',
  'SOL/USD': 'CRYPTO:SOL',
  'XRP/USD': 'CRYPTO:XRP',
  'XAU/USD': 'FOREX:XAU',
  'EUR/USD': 'FOREX:EUR',
  'GBP/USD': 'FOREX:GBP',
  'USD/JPY': 'FOREX:JPY',
  'AUD/USD': 'FOREX:AUD',
  'USD/CAD': 'FOREX:CAD',
};

async function getNewsSentiment(symbol) {
  const ticker = TICKER_MAP[symbol];
  if (!ticker) {
    return { available: false, message: `No news ticker mapping for ${symbol}` };
  }

  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=10&apikey=${process.env.ALPHAVANTAGE_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.Note || data.Information) {
    // Alpha Vantage returns these fields instead of an error when rate-limited
    return { available: false, message: 'News API rate limit reached (free tier: 25 requests/day)' };
  }

  if (!data.feed || data.feed.length === 0) {
    return { available: false, message: 'No recent news found for this asset' };
  }

  // Average the sentiment scores across recent articles, weighted toward this specific ticker
  let totalScore = 0;
  let count = 0;
  const headlines = [];

  for (const article of data.feed.slice(0, 5)) {
    const tickerData = article.ticker_sentiment?.find(t => t.ticker === ticker.split(':')[1] || t.ticker === ticker);
    const score = tickerData ? parseFloat(tickerData.ticker_sentiment_score) : parseFloat(article.overall_sentiment_score);

    if (!isNaN(score)) {
      totalScore += score;
      count++;
    }
    headlines.push({ title: article.title, sentiment: article.overall_sentiment_label, time: article.time_published });
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  let label = 'Neutral';
  if (avgScore > 0.15) label = 'Bullish';
  if (avgScore > 0.35) label = 'Strongly Bullish';
  if (avgScore < -0.15) label = 'Bearish';
  if (avgScore < -0.35) label = 'Strongly Bearish';

  return {
    available: true,
    averageScore: avgScore.toFixed(3),
    label,
    articleCount: count,
    recentHeadlines: headlines.slice(0, 3),
  };
}

module.exports = { getNewsSentiment };
