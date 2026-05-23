// api/screener.js — Scan satu coin, deteksi BREAKOUT atau WATCH
// Endpoint: GET /api/screener?coin=BTC
// Return: { success: true, data: { coin, signal, status, currentPrice, targetLevel, distanceToTarget, details } }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { coin } = req.query;
  if (!coin) return res.status(400).json({ success: false, error: "coin parameter required" });

  const base = coin.toUpperCase().replace(/USDT$/, "");
  const pair = base + "-USDT";

  try {
    // ── Fetch candle 4H + 1H secara paralel ──────────────────────
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

    // ── Normalize candles ────────────────────────────────────────
    const parseCandles = (raw) => raw.map(c => {
      if (typeof c === 'object' && !Array.isArray(c)) {
        return { time: c.time, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), volume: parseFloat(c.vol || c.volume || 0) };
      }
      return { time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) };
    }).sort((a, b) => a.time - b.time);

    const c4 = parseCandles(raw4);
    const c1 = parseCandles(raw1);
    const currentPrice = c1[c1.length - 1].close;

    // ── LAYER 1: Cek trend dengan EMA13/21 di 4H ─────────────────
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

    // ── LAYER 2: Cari S&R terkuat dari 1H + 4H ───────────────────
    const last72_1h = c1.slice(-72);
    const last60_4h = c4.slice(-60);
    const highs = [...last72_1h.map(c => c.high), ...last60_4h.map(c => c.high)];
    const lows  = [...last72_1h.map(c => c.low),  ...last60_4h.map(c => c.low)];
    const strongestResistance = Math.max(...highs);
    const strongestSupport    = Math.min(...lows);

    // ── LAYER 3: Breakout / Breakdown / Watch Detection ──────────
    const isBreakoutLong   = currentPrice > strongestResistance;
    const isBreakdownShort = currentPrice < strongestSupport;

    // Jarak ke level terdekat dalam %
    const distToResistance = ((strongestResistance - currentPrice) / currentPrice) * 100;
    const distToSupport    = ((currentPrice - strongestSupport) / strongestSupport) * 100;

    // ── Tentukan signal dan status ───────────────────────────────
    let signal = null, status = null, targetLevel = null, distanceToTarget = null, details = "";

    if (trendBullish && isBreakoutLong) {
      // LONG READY — sudah breakout dengan trend bullish
      signal = "LONG";
      status = "READY";
      targetLevel = strongestResistance.toFixed(4);
      distanceToTarget = "0.00";
      details = `BREAKOUT: Harga $${currentPrice.toFixed(4)} sudah menembus resistance $${strongestResistance.toFixed(4)} dengan trend BULLISH (MA13 > MA21)`;

    } else if (!trendBullish && isBreakdownShort) {
      // SHORT READY — sudah breakdown dengan trend bearish
      signal = "SHORT";
      status = "READY";
      targetLevel = strongestSupport.toFixed(4);
      distanceToTarget = "0.00";
      details = `BREAKDOWN: Harga $${currentPrice.toFixed(4)} sudah menembus support $${strongestSupport.toFixed(4)} dengan trend BEARISH (MA13 < MA21)`;

    } else if (trendBullish && distToResistance > 0 && distToResistance <= 3) {
      // LONG WATCH — bullish trend, dekat resistance
      signal = "LONG";
      status = "WATCH";
      targetLevel = strongestResistance.toFixed(4);
      distanceToTarget = distToResistance.toFixed(2);
      details = `Mendekati Resistance: Harga $${currentPrice.toFixed(4)} butuh naik ${distToResistance.toFixed(2)}% untuk breakout $${strongestResistance.toFixed(4)}`;

    } else if (!trendBullish && distToSupport > 0 && distToSupport <= 3) {
      // SHORT WATCH — bearish trend, dekat support
      signal = "SHORT";
      status = "WATCH";
      targetLevel = strongestSupport.toFixed(4);
      distanceToTarget = distToSupport.toFixed(2);
      details = `Mendekati Support: Harga $${currentPrice.toFixed(4)} butuh turun ${distToSupport.toFixed(2)}% untuk breakdown $${strongestSupport.toFixed(4)}`;

    } else {
      // Tidak memenuhi kriteria
      return res.status(200).json({ success: false, reason: "no_signal", coin: base });
    }

    return res.status(200).json({
      success: true,
      data: {
        coin: base,
        signal,
        status,
        currentPrice: currentPrice.toFixed(4),
        targetLevel,
        distanceToTarget,
        details,
        trendBullish,
        resistance: strongestResistance.toFixed(4),
        support: strongestSupport.toFixed(4),
      },
    });

  } catch (err) {
    return res.status(200).json({ success: false, error: err.message, coin: base });
  }
}
