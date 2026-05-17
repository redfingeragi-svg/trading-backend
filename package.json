// api/market.js — v2
// Vercel Serverless Function
// Binance OHLCV → MA13/MA21 + VuManChu + Support/Resistance + Entry Zone Logic

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { symbol, timeframe } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const pair = symbol.toUpperCase().replace("USDT", "") + "USDT";
  const tf   = timeframe || "4h";

  try {
    // 100 candles for better S&R accuracy
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tf}&limit=100`;
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.text();
      return res.status(400).json({ error: `Binance error: ${err}` });
    }
    const raw = await response.json();

    const candles = raw.map(c => ({
      time:   c[0],
      open:   parseFloat(c[1]),
      high:   parseFloat(c[2]),
      low:    parseFloat(c[3]),
      close:  parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));

    const closes       = candles.map(c => c.close);
    const currentPrice = candles[candles.length - 1].close;
    const lastCandle   = candles[candles.length - 1];

    function fmt(n, d = 4) { return parseFloat(n.toFixed(d)); }

    function sma(arr, period) {
      const s = arr.slice(-period);
      return s.reduce((a, b) => a + b, 0) / s.length;
    }

    function ema(arr, period) {
      const k = 2 / (period + 1);
      let v = arr[0];
      for (let i = 1; i < arr.length; i++) v = arr[i] * k + v * (1 - k);
      return v;
    }

    // ── MA13 / MA21 ──────────────────────────────────────────────────
    const ma13     = sma(closes, 13);
    const ma21     = sma(closes, 21);
    const prevMa13 = sma(closes.slice(0, -1), 13);
    const prevMa21 = sma(closes.slice(0, -1), 21);

    const goldenCross  = prevMa13 <= prevMa21 && ma13 > ma21;
    const deathCross   = prevMa13 >= prevMa21 && ma13 < ma21;
    const maPosition   = ma13 > ma21 ? "MA13 DI ATAS MA21" : "MA13 DI BAWAH MA21";
    const maSeparation = Math.abs(((ma13 - ma21) / ma21) * 100).toFixed(3);
    const trendBullish = ma13 > ma21;

    // ── VUMANCHU CIPHER B ────────────────────────────────────────────
    const CHAN_LEN = 9, AVG_LEN = 12, OVERBOUGHT = 53, OVERSOLD = -53;

    const hlc3    = candles.map(c => (c.high + c.low + c.close) / 3);
    const emaHlc3 = hlc3.map((_, i) =>
      i < CHAN_LEN - 1 ? hlc3[i] : ema(hlc3.slice(Math.max(0, i - CHAN_LEN + 1), i + 1), CHAN_LEN)
    );
    const d = hlc3.map((v, i) => {
      const sl = hlc3.slice(Math.max(0, i - CHAN_LEN + 1), i + 1);
      return Math.abs(v - sl.reduce((a, b) => a + b, 0) / sl.length);
    });
    const emaD = d.map((_, i) => ema(d.slice(0, i + 1), CHAN_LEN));
    const ci   = hlc3.map((v, i) => (v - emaHlc3[i]) / (0.015 * emaD[i] || 1));
    const wt1  = ci.map((_, i) => ema(ci.slice(0, i + 1), AVG_LEN));
    const wt2  = wt1.map((_, i) => {
      const sl = wt1.slice(Math.max(0, i - 3), i + 1);
      return sl.reduce((a, b) => a + b, 0) / sl.length;
    });

    const lastWt1 = wt1[wt1.length - 1], lastWt2 = wt2[wt2.length - 1];
    const prevWt1 = wt1[wt1.length - 2], prevWt2 = wt2[wt2.length - 2];

    const wtCrossUp    = prevWt1 <= prevWt2 && lastWt1 > lastWt2;
    const wtCrossDown  = prevWt1 >= prevWt2 && lastWt1 < lastWt2;
    const isOverbought = lastWt1 > OVERBOUGHT;
    const isOversold   = lastWt1 < OVERSOLD;
    const vmcDot       = wtCrossUp ? "GREEN" : wtCrossDown ? "RED" : "NONE";
    const vmcCircle    = isOversold && wtCrossUp ? "GREEN_CIRCLE" : isOverbought && wtCrossDown ? "RED_CIRCLE" : "NONE";
    const vmcBullish   = vmcDot === "GREEN" || vmcCircle === "GREEN_CIRCLE";
    const vmcBearish   = vmcDot === "RED"   || vmcCircle === "RED_CIRCLE";

    // Money Flow
    let posFlow = 0, negFlow = 0;
    for (let i = candles.length - 14; i < candles.length; i++) {
      const tp  = (candles[i].high + candles[i].low + candles[i].close) / 3;
      const ptp = i > 0 ? (candles[i-1].high + candles[i-1].low + candles[i-1].close) / 3 : tp;
      const mf  = tp * candles[i].volume;
      if (tp > ptp) posFlow += mf; else negFlow += mf;
    }
    const mfr       = negFlow === 0 ? 100 : posFlow / negFlow;
    const moneyFlow = parseFloat((100 - 100 / (1 + mfr) - 50).toFixed(2));

    // ── SUPPORT & RESISTANCE ─────────────────────────────────────────
    const PIVOT_WIN = 3;
    const rawRes = [], rawSup = [];

    for (let i = PIVOT_WIN; i < candles.length - PIVOT_WIN; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - PIVOT_WIN; j <= i + PIVOT_WIN; j++) {
        if (j !== i) {
          if (candles[j].high >= candles[i].high) isHigh = false;
          if (candles[j].low  <= candles[i].low)  isLow  = false;
        }
      }
      if (isHigh) rawRes.push(candles[i].high);
      if (isLow)  rawSup.push(candles[i].low);
    }

    // Cluster nearby levels (within 0.5%)
    function clusterLevels(levels, threshold = 0.005) {
      if (!levels.length) return [];
      const sorted   = [...levels].sort((a, b) => a - b);
      const clusters = [];
      let group      = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if ((sorted[i] - group[group.length - 1]) / group[group.length - 1] <= threshold) {
          group.push(sorted[i]);
        } else {
          clusters.push(group.reduce((a, b) => a + b, 0) / group.length);
          group = [sorted[i]];
        }
      }
      clusters.push(group.reduce((a, b) => a + b, 0) / group.length);
      return clusters;
    }

    const resistanceLevels = clusterLevels(rawRes)
      .filter(r => r > currentPrice)
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map(r => fmt(r));

    const supportLevels = clusterLevels(rawSup)
      .filter(s => s < currentPrice)
      .sort((a, b) => b - a)
      .slice(0, 3)
      .map(s => fmt(s));

    const nearestResistance = resistanceLevels[0] || null;
    const nearestSupport    = supportLevels[0]    || null;

    // ── ENTRY ZONE LOGIC (2.5% rule) ─────────────────────────────────
    // LONG: price within 2.5% above support  → entry zone = [support, support × 1.025]
    // SHORT: price within 2.5% below resistance → entry zone = [resistance × 0.975, resistance]
    // SL LONG:  support × 0.98  (2% below support)
    // SL SHORT: resistance × 1.02 (2% above resistance)
    // TP: always 1:3 RR

    const ENTRY_BUFFER = 0.025;
    const SL_BUFFER    = 0.02;

    let longZone = null, shortZone = null;

    if (nearestSupport) {
      const entryMax     = nearestSupport * (1 + ENTRY_BUFFER);
      const inZone       = currentPrice >= nearestSupport && currentPrice <= entryMax;
      const distPct      = ((currentPrice - nearestSupport) / nearestSupport * 100).toFixed(2);
      const sl           = fmt(nearestSupport * (1 - SL_BUFFER));
      const entry        = inZone ? fmt(currentPrice) : null;
      const risk         = entry ? fmt(entry - sl) : null;
      const tp           = entry ? fmt(entry + risk * 3) : null;

      longZone = {
        supportLevel: fmt(nearestSupport),
        entryZoneMin: fmt(nearestSupport),
        entryZoneMax: fmt(entryMax),
        inZone,
        distancePct:  distPct + "%",
        sl,
        slNote: "2% di bawah level support",
        entry,
        tp,
        risk,
        reward: risk ? fmt(risk * 3) : null,
        rrCalc: risk ? `Risk: ${risk} | Reward: ${fmt(risk * 3)} | RR: 1:3` : null,
      };
    }

    if (nearestResistance) {
      const entryMin     = nearestResistance * (1 - ENTRY_BUFFER);
      const inZone       = currentPrice >= entryMin && currentPrice <= nearestResistance;
      const distPct      = ((nearestResistance - currentPrice) / currentPrice * 100).toFixed(2);
      const sl           = fmt(nearestResistance * (1 + SL_BUFFER));
      const entry        = inZone ? fmt(currentPrice) : null;
      const risk         = entry ? fmt(sl - entry) : null;
      const tp           = entry ? fmt(entry - risk * 3) : null;

      shortZone = {
        resistanceLevel: fmt(nearestResistance),
        entryZoneMin:    fmt(entryMin),
        entryZoneMax:    fmt(nearestResistance),
        inZone,
        distancePct:     distPct + "%",
        sl,
        slNote: "2% di atas level resistance",
        entry,
        tp,
        risk,
        reward: risk ? fmt(risk * 3) : null,
        rrCalc: risk ? `Risk: ${risk} | Reward: ${fmt(risk * 3)} | RR: 1:3` : null,
      };
    }

    // Composite validity: trend + VMC + entry zone
    const validLong  = trendBullish  && (vmcBullish || moneyFlow > 0) && (longZone?.inZone  ?? false);
    const validShort = !trendBullish && (vmcBearish || moneyFlow < 0) && (shortZone?.inZone ?? false);

    let setupSummary = null;
    if      (validLong  && longZone?.entry)  setupSummary = { direction: "LONG",  ...longZone  };
    else if (validShort && shortZone?.entry) setupSummary = { direction: "SHORT", ...shortZone };

    // Swing ref (last 10 candles)
    const recent10  = candles.slice(-10);
    const swingHigh = fmt(Math.max(...recent10.map(c => c.high)));
    const swingLow  = fmt(Math.min(...recent10.map(c => c.low)));

    return res.status(200).json({
      pair, timeframe: tf,
      currentPrice: fmt(currentPrice),
      lastCandleBullish: lastCandle.close > lastCandle.open,
      candleCount: candles.length,
      timestamp: new Date().toISOString(),
      // MA
      ma13: fmt(ma13), ma21: fmt(ma21),
      maPosition, maSeparation: maSeparation + "%",
      goldenCross, deathCross,
      maStatus: goldenCross ? "GOLDEN CROSS BARU" : deathCross ? "DEATH CROSS BARU" : maPosition,
      trendBullish,
      // VMC
      vmc: {
        wt1: fmt(lastWt1, 2), wt2: fmt(lastWt2, 2),
        dot: vmcDot, circle: vmcCircle,
        isOverbought, isOversold, wtCrossUp, wtCrossDown,
        moneyFlow, moneyFlowLabel: moneyFlow > 0 ? "POSITIF" : "NEGATIF",
        bullish: vmcBullish, bearish: vmcBearish,
      },
      // S&R
      sr: { resistanceLevels, supportLevels, nearestResistance, nearestSupport },
      // Entry Zones
      entryZone: { long: longZone, short: shortZone, validLong, validShort },
      // Pre-computed setup
      setupSummary,
      swingHigh, swingLow,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
