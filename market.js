require('dotenv').config();

async function getPrice(pair = 'EUR/USD') {
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${process.env.TWELVEDATA_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'error') {
    throw new Error(data.message);
  }

  return data; // { price: "1.0854" }
}

module.exports = { getPrice };
