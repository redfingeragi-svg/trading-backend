// api/screener.js - Optimized Version
export default async function handler(req, res) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { coin } = req.query;

  // Jika tidak ada parameter coin, kirim daftar 100 koin untuk diproses client
  if (!coin) {
    return res.status(200).json({
      success: true,
      coins: ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "MATIC", "LTC", "NEAR", "OP", "ARB", "INJ", "RNDR", "APT", "SUI", "SEI", "FET", "GALA", "SAND", "MANA", "FTM", "WLD", "TIA", "PEPE", "SHIB", "BCH", "ETC", "FIL", "ICP", "STX", "IMX", "GRT", "SNX", "MKR", "AAVE", "LDO", "RUNE", "QNT", "ALGO", "EGLD", "AXS", "THETA", "KAS", "ORDI", "1000SATS", "BONK", "WIF", "JUP", "PYTH", "DYM", "MANTA", "ALT", "STRK", "PIXEL", "PORTAL", "AEVO", "ETHFI", "ENA", "W", "TNSR", "OMNI", "REZ", "BB", "NOT", "IO", "ZK", "ZRO", "BLAST", "RENDER", "TON", "TRX", "XLM", "XMR", "VET", "AR", "HBAR", "MNT", "CRO", "ONDO", "PENDLE", "JTO", "CORE", "FLR", "KAVA", "GMX", "CFX", "FLOKI", "MEME", "BOME", "MEW", "BRETT", "POPCAT", "MOG", "DEGEN", "NEIRO", "TURBO"]
    });
  }

  const PROXIMITY_THRESHOLD = 0.03; // 3%

  try {
    const pair = coin + "-USDT";
    const [res4h, res1h] = await Promise.all([
      fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=4h&limit=100`).then(r => r.json()),
      fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=1h&limit=100`).then(r => r.json())
    ]);

    // Defensive check
    if (!res4h?.data || !res1h?.data) return res.status(200).json({ success: true, data: null });

    // Kirim data mentah ke client agar diproses oleh fungsi makeDecision yang sudah ada di App.jsx
    // Ini adalah cara paling optimal agar hasil screener selalu sama dengan analisis manual
    return res.status(200).json({
      success: true,
      data: {
        coin,
        d4: { 
          currentPrice: res4h.data[res4h.data.length - 1].close, 
          candles: res4h.data,
          pair: pair,
          timestamp: new Date().toISOString()
        },
        d1: { candles: res1h.data }
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
