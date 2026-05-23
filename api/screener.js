// api/screener.js — Scan satu coin dengan logika BREAKOUT yang dioptimalkan
// FIX: "Self-reference" — buang 3 candle terbaru dari pencarian S&R
// Endpoint: GET /api/screener?coin=BTC

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { coin } = req.query;
  if (!coin) return res.status(400).json({ success: false, error: "coin required" });

  const base = coin.toUpperCase().replace(/USDT$/, "");
  const pair = base + "-USDT";

  try {
    const [r4, r1] = await Promise.all([
      fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=4h&limit=100`),
      fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=1h&limit=100`),
    ]);
    const [j4, j1] = await Promise.all([r4.json(), r1.json()]);

    const raw4 = j4.data || j4;
    const raw1 = j1.data || j1;
    if (!Array.isArray(raw4) || raw4.length < 30 || !Array.isArray(raw1) || raw1.length < 30) {
      return res.status(200).json({ success: false, error: `Insufficient candles for ${base}` });
    }

    const parseCandles = (raw) => raw.map(c => {
      if (typeof c === 'object' && !Array.isArray(c)) {
        return { time: c.time, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), volume: parseFloat(c.vol || c.volume || 0) };
      }
      return { time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) };
    }).sort((a, b) => a.time - b.time);

    const c4 = parseCandles(raw4);
    const c1 = parseCandles(raw1);
    const currentPrice = c1[c1.length - 1].close;

    // ── LAYER 1: Trend EMA 13/21 di 4H ───────────────────────────
    const calcEMA = (data, period) => {
      const k = 2 / (period + 1);
      let ema = [data[0]];
      for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i-1] * (1-k));
      return ema;
    };
    const closes4 = c4.map(c => c.close);
    const ema13 = calcEMA(closes4, 13);
    const ema21 = calcEMA(closes4, 21);
    const ma13 = ema13[ema13.length - 1];
    const ma21 = ema21[ema21.length - 1];
    const trendBullish = ma13 > ma21;

    // ══════════════════════════════════════════════════════════════
    // LAYER 2: S&R TERKUAT — FIXED dengan EXCLUDE 3 CANDLE TERBARU
    // ══════════════════════════════════════════════════════════════
    // BASE PENCARIAN:
    //   - TF 1H: 72 candle terakhir (3 hari)
    //   - TF 4H: 60 candle terakhir (10 hari)
    // BUANG 3 candle terbaru dari masing-masing → menghindari self-reference
    // ══════════════════════════════════════════════════════════════
    const EXCLUDE_RECENT = 3;

    const base1h = c1.slice(-72);                          // 72 candle 1H (3 hari)
    const base4h = c4.slice(-60);                          // 60 candle 4H (10 hari)

    const historical1h = base1h.slice(0, -EXCLUDE_RECENT); // 69 candle untuk pencarian
    const historical4h = base4h.slice(0, -EXCLUDE_RECENT); // 57 candle untuk pencarian

    const highs = [
      ...historical1h.map(c => c.high),
      ...historical4h.map(c => c.high),
    ];
    const lows = [
      ...historical1h.map(c => c.low),
      ...historical4h.map(c => c.low),
    ];

    const strongestResistance = Math.max(...highs);
    const strongestSupport    = Math.min(...lows);

    // ══════════════════════════════════════════════════════════════
    // LAYER 3: BREAKOUT DETECTION dengan REAL-TIME PRICE
    // Buffer 0.3% untuk filter false breakout tipis
    // ══════════════════════════════════════════════════════════════
    const BREAKOUT_CONFIRM = 0.003;

    const isBreakoutLong   = currentPrice > strongestResistance * (1 + BREAKOUT_CONFIRM);
    const isBreakdownShort = currentPrice < strongestSupport    * (1 - BREAKOUT_CONFIRM);

    const distToResistance = ((strongestResistance - currentPrice) / currentPrice) * 100;
    const distToSupport    = ((currentPrice - strongestSupport)    / strongestSupport) * 100;
    const breakoutPct      = ((currentPrice - strongestResistance) / strongestResistance) * 100;
    const breakdownPct     = ((strongestSupport - currentPrice)    / strongestSupport) * 100;

    let signal = null, status = null, targetLevel = null, distanceToTarget = null, details = "";

    if (trendBullish && isBreakoutLong) {
      signal = "LONG"; status = "READY";
      targetLevel = strongestResistance.toFixed(4);
      distanceToTarget = "0.00";
      details = `BREAKOUT ${breakoutPct.toFixed(2)}% di atas resistance historis $${strongestResistance.toFixed(4)} (3 hari 1H + 10 hari 4H, exclude 3 candle terbaru)`;

    } else if (!trendBullish && isBreakdownShort) {
      signal = "SHORT"; status = "READY";
      targetLevel = strongestSupport.toFixed(4);
      distanceToTarget = "0.00";
      details = `BREAKDOWN ${breakdownPct.toFixed(2)}% di bawah support historis $${strongestSupport.toFixed(4)} (3 hari 1H + 10 hari 4H, exclude 3 candle terbaru)`;

    } else if (trendBullish && distToResistance > 0 && distToResistance <= 3) {
      signal = "LONG"; status = "WATCH";
      targetLevel = strongestResistance.toFixed(4);
      distanceToTarget = distToResistance.toFixed(2);
      details = `Mendekati resistance $${strongestResistance.toFixed(4)} — butuh naik ${distToResistance.toFixed(2)}% untuk breakout`;

    } else if (!trendBullish && distToSupport > 0 && distToSupport <= 3) {
      signal = "SHORT"; status = "WATCH";
      targetLevel = strongestSupport.toFixed(4);
      distanceToTarget = distToSupport.toFixed(2);
      details = `Mendekati support $${strongestSupport.toFixed(4)} — butuh turun ${distToSupport.toFixed(2)}% untuk breakdown`;

    } else {
      return res.status(200).json({ success: false, reason: "no_signal", coin: base });
    }

    return res.status(200).json({
      success: true,
      data: {
        coin: base, signal, status,
        currentPrice: currentPrice.toFixed(4),
        targetLevel, distanceToTarget, details,
        trendBullish,
        resistance: strongestResistance.toFixed(4),
        support: strongestSupport.toFixed(4),
      },
    });

  } catch (err) {
    return res.status(200).json({ success: false, error: err.message, coin: base });
  }
}
