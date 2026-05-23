// api/market.js — v3 (BingX compatible)
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { symbol, timeframe } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const base = symbol.toUpperCase().replace("USDT", "");
  const pair = base + "-USDT"; // BingX format: BTC-USDT
  const tf   = timeframe || "4h";

  // Map timeframe to BingX format
  const tfMap = { "1h":"1h","4h":"4h","1d":"1d","15m":"15m","30m":"30m" };
  const bingxTf = tfMap[tf] || "4h";

  try {
    const url = `https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=${bingxTf}&limit=100`;
    const response = await fetch(url);
    const json = await response.json();

    let rawData = json.data || json;
    if (!rawData || !Array.isArray(rawData)) return res.status(400).json({ error: "Invalid data format from BingX" });

    // Normalize BingX candles
    const candles = rawData.map(c => {
      // BingX API often returns an object: { time, open, high, low, close, vol }
      if (typeof c === 'object' && !Array.isArray(c)) {
         return { time: c.time, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), volume: parseFloat(c.vol || c.volume || 0) };
      }
      return { time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) };
    }).sort((a,b)=>a.time-b.time);

    if (candles.length < 50) return res.status(400).json({ error: "Not enough candles" });

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const currentPrice = closes[closes.length - 1];
    const lastCandle = candles[candles.length - 1];

    // Helper functions for MA
    const calcEMA = (data, period) => {
      const k = 2 / (period + 1);
      let ema = [data[0]];
      for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i-1] * (1 - k));
      return ema;
    };
    
    // Calculate EMA 13 and 21
    const ema13Arr = calcEMA(closes, 13);
    const ema21Arr = calcEMA(closes, 21);
    const ma13 = ema13Arr[ema13Arr.length - 1];
    const ma21 = ema21Arr[ema21Arr.length - 1];
    const prevMa13 = ema13Arr[ema13Arr.length - 2];
    const prevMa21 = ema21Arr[ema21Arr.length - 2];

    const maSeparation = ((Math.abs(ma13 - ma21) / ma21) * 100).toFixed(2);
    const trendBullish = ma13 > ma21;
    const goldenCross = prevMa13 <= prevMa21 && ma13 > ma21;
    const deathCross = prevMa13 >= prevMa21 && ma13 < ma21;

    // VuManChu Approximation
    const calcSMA = (data, period) => {
      let sma = [];
      for(let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for(let j = 0; j < period; j++) sum += data[i-j];
        sma.push(sum / period);
      }
      return sma;
    };
    
    // WaveTrend
    const typicalPrice = candles.map(c => (c.high + c.low + c.close) / 3);
    const esa = calcEMA(typicalPrice, 10);
    const d = calcEMA(typicalPrice.map((tp, i) => Math.abs(tp - esa[i])), 10);
    const ci = typicalPrice.map((tp, i) => {
        if (i < 10) return 0;
        return d[i] === 0 ? 0 : (tp - esa[i]) / (0.015 * d[i]);
    });
    const wt1 = calcEMA(ci, 21);
    const wt2 = calcSMA(wt1, 4);

    const lastWt1 = wt1[wt1.length - 1];
    const lastWt2 = wt2[wt2.length - 1];
    const prevWt1 = wt1[wt1.length - 2];
    const prevWt2 = wt2[wt2.length - 2];

    const wtCrossUp = prevWt1 <= prevWt2 && lastWt1 > lastWt2;
    const wtCrossDown = prevWt1 >= prevWt2 && lastWt1 < lastWt2;
    const isOverbought = lastWt1 > 60;
    const isOversold = lastWt1 < -60;

    let vmcDot = "NONE";
    if (wtCrossUp && lastWt1 < 0) vmcDot = "GREEN";
    if (wtCrossDown && lastWt1 > 0) vmcDot = "RED";

    let vmcCircle = "NONE";
    if (wtCrossDown && isOverbought) vmcCircle = "RED";
    if (wtCrossUp && isOversold) vmcCircle = "GREEN";

    const vmcBullish = lastWt1 > lastWt2 && lastWt1 > 0;
    const vmcBearish = lastWt1 < lastWt2 && lastWt1 < 0;
    
    // Simple money flow approx
    const mf = ((lastCandle.close - lastCandle.low) - (lastCandle.high - lastCandle.close)) / (lastCandle.high - lastCandle.low) * lastCandle.volume;

    // S&R Approximation
    const lookback = 20;
    let supportLevels = [], resistanceLevels = [];
    for(let i=lookback; i<candles.length-lookback; i++) {
        const isSupport = lows[i] === Math.min(...lows.slice(i-lookback, i+lookback));
        const isResistance = highs[i] === Math.max(...highs.slice(i-lookback, i+lookback));
        if(isSupport) supportLevels.push(lows[i]);
        if(isResistance) resistanceLevels.push(highs[i]);
    }
    
    const nearestSupport = supportLevels.filter(s => s < currentPrice).sort((a,b)=>b-a)[0] || null;
    const nearestResistance = resistanceLevels.filter(r => r > currentPrice).sort((a,b)=>a-b)[0] || null;

    let longZone = null, shortZone = null;
    function fmt(n, d=4) { return n==null?"—":parseFloat(n).toFixed(d); }

    if (nearestSupport) {
      const zoneMax = nearestSupport * 1.02;
      const dist = ((currentPrice - nearestSupport) / nearestSupport * 100);
      const risk = currentPrice - (nearestSupport * 0.98);
      longZone = { inZone: currentPrice <= zoneMax, entryZoneMin:fmt(nearestSupport), entryZoneMax:fmt(zoneMax), distancePct: fmt(dist,2)+"%", risk:fmt(risk), reward:fmt(risk*3), rrCalc:`Risk: ${fmt(risk)} | Reward: ${fmt(risk*3)} | RR: 1:3` };
    }
    if (nearestResistance) {
      const zoneMin = nearestResistance * 0.98;
      const dist = ((nearestResistance - currentPrice) / nearestResistance * 100);
      const risk = (nearestResistance * 1.02) - currentPrice;
      shortZone = { inZone: currentPrice >= zoneMin, entryZoneMin:fmt(zoneMin), entryZoneMax:fmt(nearestResistance), distancePct: fmt(dist,2)+"%", risk:fmt(risk), reward:fmt(risk*3), rrCalc:`Risk: ${fmt(risk)} | Reward: ${fmt(risk*3)} | RR: 1:3` };
    }

    const validLong  = trendBullish  && (vmcBullish||mf>0) && (longZone?.inZone??false);
    const validShort = !trendBullish && (vmcBearish||mf<0) && (shortZone?.inZone??false);

    return res.status(200).json({
      pair: base+"USDT", timeframe:tf,
      currentPrice:fmt(currentPrice), lastCandleBullish:lastCandle.close>lastCandle.open,
      candleCount:candles.length, timestamp:new Date().toISOString(),
      ma13:fmt(ma13), ma21:fmt(ma21),
      maPosition:ma13>ma21?"MA13 DI ATAS MA21":"MA13 DI BAWAH MA21",
      maSeparation:maSeparation+"%", goldenCross, deathCross,
      maStatus:goldenCross?"GOLDEN CROSS BARU":deathCross?"DEATH CROSS BARU":ma13>ma21?"MA13 DI ATAS MA21":"MA13 DI BAWAH MA21",
      trendBullish,
      vmc:{ wt1:fmt(lastWt1,2), wt2:fmt(lastWt2,2), dot:vmcDot, circle:vmcCircle,
        isOverbought, isOversold, wtCrossUp, wtCrossDown, moneyFlow:fmt(mf) },
      entryZone:{ long:longZone, short:shortZone },
      sr:{
        nearestSupport:fmt(nearestSupport), nearestResistance:fmt(nearestResistance),
        supportLevels:supportLevels.map(s=>fmt(s)), resistanceLevels:resistanceLevels.map(r=>fmt(r))
      },
      candles: candles
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to fetch market data" });
  }
}
