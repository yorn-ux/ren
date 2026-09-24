module.exports = [
  // Forex
  { symbol: 'EUR/USD', name: 'EUR/USD', type: 'forex' },
  { symbol: 'GBP/USD', name: 'GBP/USD', type: 'forex' },
  { symbol: 'USD/JPY', name: 'USD/JPY', type: 'forex' },
  { symbol: 'AUD/USD', name: 'AUD/USD', type: 'forex' },
  { symbol: 'USD/CAD', name: 'USD/CAD', type: 'forex' },

  // Commodities
  { symbol: 'XAU/USD', name: 'Gold', type: 'commodity' },

  // Crypto (routed through Binance)
  { symbol: 'BTC/USD', name: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETH/USD', name: 'Ethereum', type: 'crypto' },
  { symbol: 'SOL/USD', name: 'Solana', type: 'crypto' },
  { symbol: 'XRP/USD', name: 'XRP', type: 'crypto' },
  { symbol: 'NEAR/USD', name: 'NEAR Protocol', type: 'crypto' },
  { symbol: 'ZEC/USD', name: 'Zcash', type: 'crypto' },
];
