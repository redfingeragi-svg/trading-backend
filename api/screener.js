export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { coin } = req.query;
  if (!coin) return res.status(400).json({ success: false, error: "Parameter 'coin' wajib diisi" });

  const PROXIMITY_THRESHOLD = 0.03;

  try {
    const pair = coin + "-USDT";
    const [r4, r1] = await Promise.all([
      fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=4h&limit=100`).then(r => r.json()),
      fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=1h&limit=100`).then(r => r.json())
    ]);

    if (!r4.data || !r1.data) return res.status(200).json({ success: true, data: null });

    // Kirim data mentah ke client untuk diproses oleh logika makeDecision di frontend
    // atau jika ingin server-side, kita gunakan hasil kalkulasi di bawah:
    return res.status(200).json({
      success: true,
      data: {
        d4: { currentPrice: r4.data[r4.data.length-1].close, candles: r4.data, ... }, // Sesuai format makeDecision
        d1: { candles: r1.data, ... }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
    // Jika data BingX kosong untuk token ini, lewati dengan aman
    if (!res4h.data || !res1h.data) return res.status(200).json({ success: true, data: null });

    const parseCandles = (data) => data.map(c => {
      if (typeof c === 'object' && !Array.isArray(c)) {
        return { time: c.time, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), volume: parseFloat(c.vol || c.volume || 0) };
      }
      return { time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) };
    }).sort((a,b)=>a.time-b.time);

    const c4 = parseCandles(res4h.data);
    const c1 = parseCandles(res1h.data);

    // Skip jika history candle belum cukup
    if (c4.length < 60 || c1.length < 72) return res.status(200).json({ success: true, data: null });

    const cp = c4[c4.length - 1].close;

    // ── HELPER MA ──
    const calcEMA = (data, period) => {
      const k = 2 / (period + 1);
      let ema = [data[0]];
      for (let j = 1; j < data.length; j++) ema.push(data[j] * k + ema[j-1] * (1 - k));
      return ema;
    };

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

    const isBreakoutLong = strongestResistance && cp > strongestResistance;
    const isBreakdownShort = strongestSupport && cp < strongestSupport;

    const distToRes = strongestResistance ? Math.abs(strongestResistance - cp) / strongestResistance : 1;
    const distToSup = strongestSupport ? Math.abs(cp - strongestSupport) / strongestSupport : 1;

    let status = null, signal = null, targetLevel = null, distanceToTarget = null;

    if (l1Long) {
      if (isBreakoutLong && volumeValid) {
        status = "READY"; signal = "LONG"; targetLevel = strongestResistance; distanceToTarget = 0;
      } else if (cp <= strongestResistance && distToRes <= PROXIMITY_THRESHOLD) {
        status = "WATCH"; signal = "LONG"; targetLevel = strongestResistance; distanceToTarget = distToRes * 100;
      }
    } else if (l1Short) {
      if (isBreakdownShort && volumeValid) {
        status = "READY"; signal = "SHORT"; targetLevel = strongestSupport; distanceToTarget = 0;
      } else if (cp >= strongestSupport && distToSup <= PROXIMITY_THRESHOLD) {
        status = "WATCH"; signal = "SHORT"; targetLevel = strongestSupport; distanceToTarget = distToSup * 100;
      }
    }

    if (status) {
      return res.status(200).json({
        success: true,
        data: {
          coin,
          currentPrice: cp.toFixed(4),
          signal,
          status,
          targetLevel: targetLevel.toFixed(4),
          distanceToTarget: distanceToTarget.toFixed(2),
          details: status === "READY" 
            ? `Breakout tervalidasi dgn Volume (${currentVolume.toFixed(0)} > SMA ${smaVolume20.toFixed(0)})`
            : `Mendekati level target. Jarak ${distanceToTarget.toFixed(2)}%`
        }
      });
    }

    // Jika koin tidak memenuhi kriteria, kembalikan data null
    return res.status(200).json({ success: true, data: null });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
