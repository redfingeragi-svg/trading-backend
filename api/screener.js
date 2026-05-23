// api/screener.js — Scan dengan TOP 3 FILTERS:
//   1. Market Regime (TRENDING only)
//   2. Volume Surge 2x SMA20
//   3. Konfluensi 4H + 1H WAJIB
// Endpoint: GET /api/screener?coin=BTC

// ── HELPER: Market Regime Detection ──────────────────────────────
function detectMarketRegime(candles) {
  if (!candles || candles.length < 50) return "UNKNOWN";
  const closes = candles.map(c => c.close);
  const recent20 = closes.slice(-20);
  const sma20 = recent20.reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const high20 = Math.max(...recent20);
  const low20  = Math.min(...recent20);
  const rangePct = ((high20 - low20) / sma20) * 100;
  const maGapPct = (Math.abs(sma20 - sma50) / sma50) * 100;
  if (maGapPct > 2 && rangePct > 5) return "TRENDING";
  if (rangePct < 3)                  return "RANGING";
  return "MIXED";
}

// ── HELPER: EMA Calculation ──────────────────────────────────────
function calcEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = [data[0]];
  for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i-1] * (1-k));
  return ema;
}

// ── HELPER: Parse BingX candles ──────────────────────────────────
function parseCandles(raw) {
  return raw.map(c => {
    if (typeof c === 'object' && !Array.isArray(c)) {
      return { time: c.time, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), volume: parseFloat(c.vol || c.volume || 0) };
    }
    return { time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) };
  }).sort((a, b) => a.time - b.time);
}

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
    if (!Array.isArray(raw4) || raw4.length < 50 || !Array.isArray(raw1) || raw1.length < 30) {
      return res.status(200).json({ success: false, error: `Insufficient candles for ${base}` });
    }

    const c4 = parseCandles(raw4);
    const c1 = parseCandles(raw1);
    const currentPrice = c1[c1.length - 1].close;

    // ══════════════════════════════════════════════════════════════
    // FILTER #1: MARKET REGIME — skip coin yang tidak TRENDING
    // ══════════════════════════════════════════════════════════════
    const regime = detectMarketRegime(c4);
    if (regime !== "TRENDING") {
      return res.status(200).json({
        success: false,
        reason: "not_trending",
        coin: base,
        regime,
      });
    }

    // ── Trend Detection 4H + 1H (untuk Filter #3 Konfluensi) ─────
    const closes4 = c4.map(c => c.close);
    const closes1 = c1.map(c => c.close);
    const ema13_4h = calcEMA(closes4, 13);
    const ema21_4h = calcEMA(closes4, 21);
    const ema13_1h = calcEMA(closes1, 13);
    const ema21_1h = calcEMA(closes1, 21);
    const trendBullish_4h = ema13_4h[ema13_4h.length-1] > ema21_4h[ema21_4h.length-1];
    const trendBullish_1h = ema13_1h[ema13_1h.length-1] > ema21_1h[ema21_1h.length-1];

    // ══════════════════════════════════════════════════════════════
    // FILTER #3: KONFLUENSI WAJIB — 4H dan 1H harus sama arah
    // ══════════════════════════════════════════════════════════════
    const isFullBullish = trendBullish_4h && trendBullish_1h;
    const isFullBearish = !trendBullish_4h && !trendBullish_1h;
    const isFullConfluence = isFullBullish || isFullBearish;

    if (!isFullConfluence) {
      return res.status(200).json({
        success: false,
        reason: "no_confluence",
        coin: base,
        trend4h: trendBullish_4h ? "BULLISH" : "BEARISH",
        trend1h: trendBullish_1h ? "BULLISH" : "BEARISH",
      });
    }

    // ── S&R Terkuat dengan EXCLUDE 3 candle terbaru ──────────────
    const EXCLUDE_RECENT = 3;
    const base1h = c1.slice(-72);
    const base4h = c4.slice(-60);
    const hist1h = base1h.slice(0, -EXCLUDE_RECENT);
    const hist4h = base4h.slice(0, -EXCLUDE_RECENT);
    const highs = [...hist1h.map(c => c.high), ...hist4h.map(c => c.high)];
    const lows  = [...hist1h.map(c => c.low),  ...hist4h.map(c => c.low)];
    const strongestResistance = Math.max(...highs);
    const strongestSupport    = Math.min(...lows);

    // ══════════════════════════════════════════════════════════════
    // FILTER #2: VOLUME SURGE — minimal 2x SMA20
    // ══════════════════════════════════════════════════════════════
    const VOLUME_SURGE_MIN = 2.0;
    const volCandles = c1.slice(-21, -1);
    const currentVol = c1[c1.length - 1].volume;
    const smaVol20   = volCandles.reduce((a, c) => a + c.volume, 0) / volCandles.length;
    const volumeRatio = smaVol20 > 0 ? currentVol / smaVol20 : 0;
    const volumeSurge = volumeRatio >= VOLUME_SURGE_MIN;

    // ── Breakout Detection ───────────────────────────────────────
    const BREAKOUT_CONFIRM = 0.003;
    const isBreakoutLong   = currentPrice > strongestResistance * (1 + BREAKOUT_CONFIRM);
    const isBreakdownShort = currentPrice < strongestSupport    * (1 - BREAKOUT_CONFIRM);

    const distToResistance = ((strongestResistance - currentPrice) / currentPrice) * 100;
    const distToSupport    = ((currentPrice - strongestSupport)    / strongestSupport) * 100;

    // ══════════════════════════════════════════════════════════════
    // SIGNAL CLASSIFICATION dengan TOP 3 FILTER
    // READY  = breakout + volume surge (semua filter lolos)
    // WATCH  = breakout tapi volume rendah, ATAU mendekati level
    // ══════════════════════════════════════════════════════════════
    let signal = null, status = null, targetLevel = null, distanceToTarget = null, details = "";

    if (isFullBullish && isBreakoutLong) {
      signal = "LONG";
      targetLevel = strongestResistance.toFixed(4);
      distanceToTarget = "0.00";
      if (volumeSurge) {
        status = "READY";
        details = `✅ BREAKOUT + ALL FILTERS PASS: Trending + Konfluensi 4H/1H BULLISH + Volume ${volumeRatio.toFixed(2)}x SMA20 (≥2x). Breakout di atas resistance $${strongestResistance.toFixed(4)}`;
      } else {
        status = "WATCH";
        details = `⚠️ BREAKOUT tapi volume cuma ${volumeRatio.toFixed(2)}x SMA20 (butuh ≥2x). Risiko fakeout. Tunggu volume surge.`;
      }

    } else if (isFullBearish && isBreakdownShort) {
      signal = "SHORT";
      targetLevel = strongestSupport.toFixed(4);
      distanceToTarget = "0.00";
      if (volumeSurge) {
        status = "READY";
        details = `✅ BREAKDOWN + ALL FILTERS PASS: Trending + Konfluensi 4H/1H BEARISH + Volume ${volumeRatio.toFixed(2)}x SMA20 (≥2x). Breakdown di bawah support $${strongestSupport.toFixed(4)}`;
      } else {
        status = "WATCH";
        details = `⚠️ BREAKDOWN tapi volume cuma ${volumeRatio.toFixed(2)}x SMA20 (butuh ≥2x). Risiko fakeout. Tunggu volume surge.`;
      }

    } else if (isFullBullish && distToResistance > 0 && distToResistance <= 3) {
      signal = "LONG"; status = "WATCH";
      targetLevel = strongestResistance.toFixed(4);
      distanceToTarget = distToResistance.toFixed(2);
      details = `Mendekati resistance $${strongestResistance.toFixed(4)} — butuh naik ${distToResistance.toFixed(2)}%. Konfluensi 4H/1H sudah BULLISH ✅. Tunggu breakout + volume surge.`;

    } else if (isFullBearish && distToSupport > 0 && distToSupport <= 3) {
      signal = "SHORT"; status = "WATCH";
      targetLevel = strongestSupport.toFixed(4);
      distanceToTarget = distToSupport.toFixed(2);
      details = `Mendekati support $${strongestSupport.toFixed(4)} — butuh turun ${distToSupport.toFixed(2)}%. Konfluensi 4H/1H sudah BEARISH ✅. Tunggu breakdown + volume surge.`;

    } else {
      return res.status(200).json({ success: false, reason: "no_signal", coin: base });
    }

    return res.status(200).json({
      success: true,
      data: {
        coin: base, signal, status,
        currentPrice: currentPrice.toFixed(4),
        targetLevel, distanceToTarget, details,
        regime,
        trend4h: trendBullish_4h ? "BULLISH" : "BEARISH",
        trend1h: trendBullish_1h ? "BULLISH" : "BEARISH",
        confluence: isFullConfluence,
        volumeRatio: volumeRatio.toFixed(2),
        volumeSurge,
        resistance: strongestResistance.toFixed(4),
        support: strongestSupport.toFixed(4),
      },
    });

  } catch (err) {
    return res.status(200).json({ success: false, error: err.message, coin: base });
  }
}
