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

    // BingX returns { code, data: [ {open,high,low,close,volume,time}, ... ] }
    // or sometimes data is array of arrays
    let rawData = json.data || json;
    if (!Array.isArray(rawData)) {
      return res.status(400).json({ error: "BingX format unexpected", raw: JSON.stringify(json).slice(0,300) });
    }

    // Normalize — BingX objects have: open, high, low, close, volume, time
    const candles = rawData.map(c => {
      if (Array.isArray(c)) {
        // array format [time, open, high, low, close, volume]
        return { time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) };
      }
      return { time: Number(c.time || c.openTime || c.t || 0), open: parseFloat(c.open || c.o), high: parseFloat(c.high || c.h), low: parseFloat(c.low || c.l), close: parseFloat(c.close || c.c), volume: parseFloat(c.volume || c.v || 0) };
    }).filter(c => !isNaN(c.close));

    if (candles.length < 22) {
      return res.status(400).json({ error: `Not enough candles: ${candles.length}`, rawSample: JSON.stringify(rawData[0]) });
    }

    const closes = candles.map(c => c.close);
    const currentPrice = candles[candles.length - 1].close;
    const lastCandle   = candles[candles.length - 1];

    function fmt(n, d = 4) { return parseFloat(n.toFixed(d)); }
    function sma(arr, period) { const s = arr.slice(-period); return s.reduce((a,b)=>a+b,0)/s.length; }
    function ema(arr, period) { const k=2/(period+1); let v=arr[0]; for(let i=1;i<arr.length;i++) v=arr[i]*k+v*(1-k); return v; }

    // MA13 / MA21
    const ma13 = sma(closes, 13), ma21 = sma(closes, 21);
    const prevMa13 = sma(closes.slice(0,-1), 13), prevMa21 = sma(closes.slice(0,-1), 21);
    const goldenCross = prevMa13 <= prevMa21 && ma13 > ma21;
    const deathCross  = prevMa13 >= prevMa21 && ma13 < ma21;
    const trendBullish = ma13 > ma21;
    const maSeparation = Math.abs(((ma13-ma21)/ma21)*100).toFixed(3);

    // VuManChu
    const CHAN_LEN=9, AVG_LEN=12, OVERBOUGHT=53, OVERSOLD=-53;
    const hlc3 = candles.map(c=>(c.high+c.low+c.close)/3);
    const emaHlc3 = hlc3.map((_,i)=> i<CHAN_LEN-1?hlc3[i]:ema(hlc3.slice(Math.max(0,i-CHAN_LEN+1),i+1),CHAN_LEN));
    const d = hlc3.map((v,i)=>{ const sl=hlc3.slice(Math.max(0,i-CHAN_LEN+1),i+1); return Math.abs(v-sl.reduce((a,b)=>a+b,0)/sl.length); });
    const emaD = d.map((_,i)=>ema(d.slice(0,i+1),CHAN_LEN));
    const ci   = hlc3.map((v,i)=>(v-emaHlc3[i])/(0.015*emaD[i]||1));
    const wt1  = ci.map((_,i)=>ema(ci.slice(0,i+1),AVG_LEN));
    const wt2  = wt1.map((_,i)=>{ const sl=wt1.slice(Math.max(0,i-3),i+1); return sl.reduce((a,b)=>a+b,0)/sl.length; });

    const lastWt1=wt1[wt1.length-1], lastWt2=wt2[wt2.length-1];
    const prevWt1=wt1[wt1.length-2], prevWt2=wt2[wt2.length-2];
    const wtCrossUp   = prevWt1<=prevWt2 && lastWt1>lastWt2;
    const wtCrossDown = prevWt1>=prevWt2 && lastWt1<lastWt2;
    const isOverbought = lastWt1>OVERBOUGHT, isOversold=lastWt1<OVERSOLD;
    const vmcDot    = wtCrossUp?"GREEN":wtCrossDown?"RED":"NONE";
    const vmcCircle = isOversold&&wtCrossUp?"GREEN_CIRCLE":isOverbought&&wtCrossDown?"RED_CIRCLE":"NONE";
    const vmcBullish = vmcDot==="GREEN"||vmcCircle==="GREEN_CIRCLE";
    const vmcBearish = vmcDot==="RED"  ||vmcCircle==="RED_CIRCLE";

    // Money Flow
    let pos=0,neg=0;
    for(let i=candles.length-14;i<candles.length;i++){
      const tp=(candles[i].high+candles[i].low+candles[i].close)/3;
      const ptp=i>0?(candles[i-1].high+candles[i-1].low+candles[i-1].close)/3:tp;
      const mf=tp*candles[i].volume;
      if(tp>ptp) pos+=mf; else neg+=mf;
    }
    const mfr=neg===0?100:pos/neg;
    const moneyFlow=parseFloat((100-100/(1+mfr)-50).toFixed(2));

    // Support & Resistance
    const PIVOT_WIN=3;
    const rawRes=[],rawSup=[];
    for(let i=PIVOT_WIN;i<candles.length-PIVOT_WIN;i++){
      let isH=true,isL=true;
      for(let j=i-PIVOT_WIN;j<=i+PIVOT_WIN;j++){
        if(j!==i){ if(candles[j].high>=candles[i].high) isH=false; if(candles[j].low<=candles[i].low) isL=false; }
      }
      if(isH) rawRes.push(candles[i].high);
      if(isL) rawSup.push(candles[i].low);
    }

    function cluster(levels,threshold=0.005){
      if(!levels.length) return [];
      const sorted=[...levels].sort((a,b)=>a-b);
      const clusters=[];let group=[sorted[0]];
      for(let i=1;i<sorted.length;i++){
        if((sorted[i]-group[group.length-1])/group[group.length-1]<=threshold) group.push(sorted[i]);
        else{ clusters.push(group.reduce((a,b)=>a+b,0)/group.length); group=[sorted[i]]; }
      }
      clusters.push(group.reduce((a,b)=>a+b,0)/group.length);
      return clusters;
    }

    const resistanceLevels = cluster(rawRes).filter(r=>r>currentPrice).sort((a,b)=>a-b).slice(0,3).map(r=>fmt(r));
    const supportLevels    = cluster(rawSup).filter(s=>s<currentPrice).sort((a,b)=>b-a).slice(0,3).map(s=>fmt(s));
    const nearestResistance = resistanceLevels[0]||null;
    const nearestSupport    = supportLevels[0]||null;

    // Entry Zones (2.5% rule, SL 2%)
    const ENTRY_BUF=0.025, SL_BUF=0.02;
    let longZone=null, shortZone=null;

    if(nearestSupport){
      const entryMax=nearestSupport*(1+ENTRY_BUF);
      const inZone=currentPrice>=nearestSupport&&currentPrice<=entryMax;
      const sl=fmt(nearestSupport*(1-SL_BUF));
      const entry=inZone?fmt(currentPrice):null;
      const risk=entry?fmt(entry-sl):null;
      longZone={ supportLevel:fmt(nearestSupport), entryZoneMin:fmt(nearestSupport), entryZoneMax:fmt(entryMax),
        inZone, distancePct:((currentPrice-nearestSupport)/nearestSupport*100).toFixed(2)+"%",
        sl, slNote:"2% di bawah support", entry, tp:entry?fmt(entry+risk*3):null,
        risk, reward:risk?fmt(risk*3):null, rrCalc:risk?`Risk: ${risk} | Reward: ${fmt(risk*3)} | RR: 1:3`:null };
    }

    if(nearestResistance){
      const entryMin=nearestResistance*(1-ENTRY_BUF);
      const inZone=currentPrice>=entryMin&&currentPrice<=nearestResistance;
      const sl=fmt(nearestResistance*(1+SL_BUF));
      const entry=inZone?fmt(currentPrice):null;
      const risk=entry?fmt(sl-entry):null;
      shortZone={ resistanceLevel:fmt(nearestResistance), entryZoneMin:fmt(entryMin), entryZoneMax:fmt(nearestResistance),
        inZone, distancePct:((nearestResistance-currentPrice)/currentPrice*100).toFixed(2)+"%",
        sl, slNote:"2% di atas resistance", entry, tp:entry?fmt(entry-risk*3):null,
        risk, reward:risk?fmt(risk*3):null, rrCalc:risk?`Risk: ${risk} | Reward: ${fmt(risk*3)} | RR: 1:3`:null };
    }

    const validLong  = trendBullish  && (vmcBullish||moneyFlow>0) && (longZone?.inZone??false);
    const validShort = !trendBullish && (vmcBearish||moneyFlow<0) && (shortZone?.inZone??false);

    const recent10=candles.slice(-10);
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
        isOverbought, isOversold, wtCrossUp, wtCrossDown,
        moneyFlow, moneyFlowLabel:moneyFlow>0?"POSITIF":"NEGATIF", bullish:vmcBullish, bearish:vmcBearish },
      sr:{ resistanceLevels, supportLevels, nearestResistance, nearestSupport },
      entryZone:{ long:longZone, short:shortZone, validLong, validShort },
      swingHigh:fmt(Math.max(...recent10.map(c=>c.high))),
      swingLow:fmt(Math.min(...recent10.map(c=>c.low))),
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
