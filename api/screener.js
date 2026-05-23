export default async function handler(req, res) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 25 koin terpopuler untuk dipindai (dibatasi agar tidak timeout)
  const COINS = [
    "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", 
    "LINK", "DOT", "MATIC", "LTC", "NEAR", "OP", "ARB", "INJ", 
    "RNDR", "APT", "SUI", "SEI", "FET", "GALA", "SAND", "MANA", "FTM"
  ];
  const PROXIMITY_THRESHOLD = 0.03; // Ambang batas jarak 3%

  try {
    const results = [];
    const chunkSize = 5; // Memproses 5 koin sekaligus

    for (let i = 0; i < COINS.length; i += chunkSize) {
      const chunk = COINS.slice(i, i + chunkSize);
      
      const chunkPromises = chunk.map(async (coin) => {
        try {
          const pair = coin + "-USDT";
          
          // Mengambil data 4H dan 1H dari BingX secara paralel
          const [res4h, res1h] = await Promise.all([
            fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=4h&limit=100`).then(r => r.json()),
            fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=1h&limit=100`).then(r => r.json())
          ]);

          if (!res4h.data || !res1h.data) return null;

          // Normalisasi array candlestick BingX
          const parseCandles = (data) => data.map(c => {
            if (typeof c === 'object' && !Array.isArray(c)) {
              return { time: c.time, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), volume: parseFloat(c.vol || c.volume || 0) };
            }
            return { time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) };
          }).sort((a,b)=>a.time-b.time);

          const c4 = parseCandles(res4h.data);
          const c1 = parseCandles(res1h.data);

          if (c4.length < 60 || c1.length < 72) return null;

          const cp = c4[c4.length - 1].close;

          // ── HELPER MA ──
          const calcEMA = (data, period) => {
            const k = 2 / (period + 1);
            let ema = [data[0]];
            for (let j = 1; j < data.length; j++) ema.push(data[j] * k + ema[j-1] * (1 - k));
            return ema;
          };

          // ── LAYER 1: TREND & VMC (4H) ──
          const closes4h = c4.map(c => c.close);
          const ema13 = calcEMA(closes4h, 13);
          const ema21 = calcEMA(closes4h, 21);
          const trendBullish4h = ema13[ema13.length - 1] > ema21[ema21.length - 1];

          const closes1h = c1.map(c => c.close);
          const ema13_1h = calcEMA(closes1h, 13);
          const ema21_1h = calcEMA(closes1h, 21);
          const trendBullish1h = ema13_1h[ema13_1h.length - 1] > ema21_1h[ema21_1h.length - 1];

          const calcSMA = (data, period) => {
            let sma = [];
            for(let j = period - 1; j < data.length; j++) {
              let sum = 0;
              for(let k = 0; k < period; k++) sum += data[j-k];
              sma.push(sum / period);
            }
            return sma;
          };

          const typicalPrice = c4.map(c => (c.high + c.low + c.close) / 3);
          const esa = calcEMA(typicalPrice, 10);
          const d = calcEMA(typicalPrice.map((tp, i) => Math.abs(tp - esa[i])), 10);
          const ci = typicalPrice.map((tp, i) => (i < 10 || d[i] === 0) ? 0 : (tp - esa[i]) / (0.015 * d[i]));
          const wt1 = calcEMA(ci, 21);
          const wt2 = calcSMA(wt1, 4);
          const lastWt1 = wt1[wt1.length - 1];
          const lastWt2 = wt2[wt2.length - 1];

          const vmcBull4 = lastWt1 > lastWt2 && lastWt1 > 0;
          const vmcBear4 = lastWt1 < lastWt2 && lastWt1 < 0;

          const l1Long = trendBullish4h && vmcBull4;
          const l1Short = !trendBullish4h && vmcBear4;
          const confLong = trendBullish4h && trendBullish1h && vmcBull4;
          const confShort = !trendBullish4h && !trendBullish1h && vmcBear4;

          // ── LAYER 2: S&R TERKUAT & VOLUME ──
          const c1_hist = c1.slice(-72);
          const c4_hist = c4.slice(-60);
          const highs = [...c1_hist.map(c => c.high), ...c4_hist.map(c => c.high)];
          const lows = [...c1_hist.map(c => c.low), ...c4_hist.map(c => c.low)];
          
          const strongestResistance = highs.length ? Math.max(...highs) : null;
          const strongestSupport = lows.length ? Math.min(...lows) : null;

          const volCandles = c1.slice(-21, -1);
          const currentVolume = c1[c1.length - 1].volume || 0;
          const smaVolume20 = volCandles.length ? volCandles.reduce((a, b) => a + b.volume, 0) / volCandles.length : 0;
          const volumeValid = currentVolume > smaVolume20;

          // ── LAYER 3: BREAKOUT & PROXIMITY FILTER ──
          const isBreakoutLong = strongestResistance && cp > strongestResistance;
          const isBreakdownShort = strongestSupport && cp < strongestSupport;

          const distToRes = strongestResistance ? Math.abs(strongestResistance - cp) / strongestResistance : 1;
          const distToSup = strongestSupport ? Math.abs(cp - strongestSupport) / strongestSupport : 1;

          let status = null;
          let signal = null;
          let targetLevel = null;
          let distanceToTarget = null;
          let confidence = 0;

          if (l1Long) {
            if (isBreakoutLong && volumeValid) {
              status = "READY";
              signal = "LONG";
              targetLevel = strongestResistance;
              distanceToTarget = 0;
              confidence = confLong ? 88 : 72;
            } else if (cp <= strongestResistance && distToRes <= PROXIMITY_THRESHOLD) {
              status = "WATCH";
              signal = "LONG";
              targetLevel = strongestResistance;
              distanceToTarget = distToRes * 100;
              confidence = confLong ? 80 : 65;
            }
          } else if (l1Short) {
            if (isBreakdownShort && volumeValid) {
              status = "READY";
              signal = "SHORT";
              targetLevel = strongestSupport;
              distanceToTarget = 0;
              confidence = confShort ? 88 : 72;
            } else if (cp >= strongestSupport && distToSup <= PROXIMITY_THRESHOLD) {
              status = "WATCH";
              signal = "SHORT";
              targetLevel = strongestSupport;
              distanceToTarget = distToSup * 100;
              confidence = confShort ? 80 : 65;
            }
          }

          if (status) {
            return {
              coin,
              currentPrice: cp.toFixed(4),
              signal,
              status,
              confidence,
              targetLevel: targetLevel.toFixed(4),
              distanceToTarget: distanceToTarget.toFixed(2),
              volumeValid,
              details: status === "READY" 
                ? `Breakout tervalidasi dengan Volume (${currentVolume.toFixed(0)} > SMA ${smaVolume20.toFixed(0)})`
                : `Mendekati level target. Jarak ${distanceToTarget.toFixed(2)}%`
            };
          }
          return null;

        } catch (e) {
          return null; // Abaikan jika error untuk 1 koin
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults.filter(r => r !== null));
    }

    // Urutkan berdasarkan distanceToTarget (dari yang paling dekat ke breakout)
    results.sort((a, b) => parseFloat(a.distanceToTarget) - parseFloat(b.distanceToTarget));

    return res.status(200).json({ 
      success: true, 
      scannedCount: COINS.length,
      matchCount: results.length, 
      data: results 
    });

  } catch (error) {
    console.error("Screener error:", error);
    return res.status(500).json({ success: false, error: "Gagal menjalankan screener" });
  }
}
