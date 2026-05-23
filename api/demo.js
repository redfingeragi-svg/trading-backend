import { useState, useEffect, useRef } from "react";

const BACKEND_URL = "https://trading-backend-nu.vercel.app";

// ── KEPUTUSAN DETERMINISTIK — BREAKOUT STRATEGY ────────────────
function makeDecision(d4, d1) {
  if (!d4 || !d1) return null;
  const cp = parseFloat(d4.currentPrice);

  // ── LAYER 1: TREND (TIDAK BERUBAH) ───────────────────────────
  const trend4h  = d4.trendBullish;
  const trend1h  = d1.trendBullish;
  const vmcBull4 = d4.vmc.bullish || d4.vmc.moneyFlow > 0;
  const vmcBear4 = d4.vmc.bearish || d4.vmc.moneyFlow < 0;
  const sep4h    = parseFloat(d4.maSeparation);
  const ranging  = sep4h < 0.05;
  const l1Long   = trend4h && vmcBull4;
  const l1Short  = !trend4h && vmcBear4;
  const conf4h1hLong  = trend4h && trend1h && vmcBull4;
  const conf4h1hShort = !trend4h && !trend1h && vmcBear4;

  // ── LAYER 2: S&R TERKUAT dari candle history ─────────────────
  const c1 = (d1.candles || []).slice(-72);
  const c4 = (d4.candles || []).slice(-60);
  const highs = [...c1.map(c => c.high), ...c4.map(c => c.high)];
  const lows  = [...c1.map(c => c.low),  ...c4.map(c => c.low)];
  const strongestResistance = highs.length ? Math.max(...highs) : null;
  const strongestSupport    = lows.length  ? Math.min(...lows)  : null;

  // Volume confirmation
  const volCandles  = (d1.candles || []).slice(-21, -1);
  const currentVol  = d1.candles?.[d1.candles.length - 1]?.volume || 0;
  const smaVol20    = volCandles.length ? volCandles.reduce((a,b) => a + b.volume, 0) / volCandles.length : 0;
  const volumeValid  = currentVol > smaVol20;

  // ── LAYER 3: BREAKOUT DETECTION ──────────────────────────────
  const isBreakoutLong   = strongestResistance && cp > strongestResistance;
  const isBreakdownShort = strongestSupport    && cp < strongestSupport;

  let longSetup = null;
  if (isBreakoutLong) {
    const sl = parseFloat((strongestResistance * 0.985).toFixed(4));
    const risk = parseFloat((cp - sl).toFixed(4));
    const tp = parseFloat((cp + risk * 3).toFixed(4));
    longSetup = {
      entry: cp.toFixed(4), sl: sl.toFixed(4), tp: tp.toFixed(4),
      risk: risk.toFixed(2), reward: (risk*3).toFixed(2),
      rrCalc: `Risk: $${risk.toFixed(2)} | Reward: $${(risk*3).toFixed(2)} | RR: 1:3`,
      resistanceLevel: strongestResistance.toFixed(4),
      supportLevel: strongestSupport?.toFixed(4),
      entryNote: `Breakout Resistance $${strongestResistance.toFixed(2)}`,
    };
  }
  let shortSetup = null;
  if (isBreakdownShort) {
    const sl = parseFloat((strongestSupport * 1.015).toFixed(4));
    const risk = parseFloat((sl - cp).toFixed(4));
    const tp = parseFloat((cp - risk * 3).toFixed(4));
    shortSetup = {
      entry: cp.toFixed(4), sl: sl.toFixed(4), tp: tp.toFixed(4),
      risk: risk.toFixed(2), reward: (risk*3).toFixed(2),
      rrCalc: `Risk: $${risk.toFixed(2)} | Reward: $${(risk*3).toFixed(2)} | RR: 1:3`,
      supportLevel: strongestSupport.toFixed(4),
      resistanceLevel: strongestResistance?.toFixed(4),
      entryNote: `Breakdown Support $${strongestSupport.toFixed(2)}`,
    };
  }

  // ── FINAL DECISION ────────────────────────────────────────────
  let signal = "WAIT", setup = null, reasons = [], waitReasons = [], confidence = 0;

  if (ranging) {
    waitReasons.push(`MA separation ${sep4h}% — market RANGING, tunggu trending`);
  } else if (l1Long && isBreakoutLong && volumeValid) {
    signal = "LONG"; setup = longSetup; confidence = conf4h1hLong ? 88 : 72;
    reasons.push(`✅ L1: ${d4.maStatus} + VMC ${d4.vmc.dot !== "NONE" ? d4.vmc.dot : "MF " + d4.vmc.moneyFlow}`);
    reasons.push(`✅ L2: Resistance terkuat $${strongestResistance.toFixed(2)} | Support $${strongestSupport?.toFixed(2)}`);
    reasons.push(`✅ L3 BREAKOUT: Harga $${cp} menembus Resistance $${strongestResistance.toFixed(2)}`);
    reasons.push(`✅ VOLUME: ${currentVol.toFixed(2)} > SMA20 ${smaVol20.toFixed(2)}`);
    reasons.push(`✅ ENTRY: $${longSetup.entry} | SL: $${longSetup.sl} | TP: $${longSetup.tp}`);
    if (conf4h1hLong) reasons.push(`✅ KONFLUENSI KUAT: 4H + 1H BULLISH`);
    else reasons.push(`⚠️ 1H: ${d1.maStatus} — konfluensi parsial`);
  } else if (l1Short && isBreakdownShort && volumeValid) {
    signal = "SHORT"; setup = shortSetup; confidence = conf4h1hShort ? 88 : 72;
    reasons.push(`✅ L1: ${d4.maStatus} + VMC ${d4.vmc.dot !== "NONE" ? d4.vmc.dot : "MF " + d4.vmc.moneyFlow}`);
    reasons.push(`✅ L2: Support terkuat $${strongestSupport.toFixed(2)} | Resistance $${strongestResistance?.toFixed(2)}`);
    reasons.push(`✅ L3 BREAKDOWN: Harga $${cp} menembus Support $${strongestSupport.toFixed(2)}`);
    reasons.push(`✅ VOLUME: ${currentVol.toFixed(2)} > SMA20 ${smaVol20.toFixed(2)}`);
    reasons.push(`✅ ENTRY: $${shortSetup.entry} | SL: $${shortSetup.sl} | TP: $${shortSetup.tp}`);
    if (conf4h1hShort) reasons.push(`✅ KONFLUENSI KUAT: 4H + 1H BEARISH`);
    else reasons.push(`⚠️ 1H: ${d1.maStatus} — konfluensi parsial`);
  } else {
    if (!l1Long && !l1Short)
      waitReasons.push(`L1: Trend ${trend4h?"BULLISH":"BEARISH"} + VMC ${d4.vmc.dot} — sinyal lemah`);
    if (l1Long && !isBreakoutLong) {
      const gap = strongestResistance ? ((strongestResistance - cp)/cp*100).toFixed(2) : "?";
      waitReasons.push(`L3: Belum BREAKOUT — butuh naik ${gap}% ke resistance $${strongestResistance?.toFixed(2)}`);
    }
    if (l1Short && !isBreakdownShort) {
      const gap = strongestSupport ? ((cp - strongestSupport)/strongestSupport*100).toFixed(2) : "?";
      waitReasons.push(`L3: Belum BREAKDOWN — butuh turun ${gap}% ke support $${strongestSupport?.toFixed(2)}`);
    }
    if ((l1Long && isBreakoutLong && !volumeValid) || (l1Short && isBreakdownShort && !volumeValid))
      waitReasons.push(`VOLUME RENDAH: ${currentVol.toFixed(2)} < SMA20 ${smaVol20.toFixed(2)} — risiko fakeout`);
    if (!waitReasons.length) waitReasons.push("Kondisi belum memenuhi semua layer");
  }

  const priceContext = [];
  if (strongestSupport)    priceContext.push(`Support terkuat: $${strongestSupport.toFixed(2)}`);
  if (strongestResistance) priceContext.push(`Resistance terkuat: $${strongestResistance.toFixed(2)}`);
  priceContext.push(`Volume: ${currentVol.toFixed(2)} (SMA20: ${smaVol20.toFixed(2)})`);

  return {
    signal, confidence, setup, reasons, waitReasons, priceContext,
    layer1: { trend4h, trend1h, vmcBull4, vmcBear4, ranging, sep4h, l1Long, l1Short },
    layer2: { strongestSupport, strongestResistance, currentVol, smaVol20, volumeValid,
              inLongZone: isBreakoutLong, inShortZone: isBreakdownShort },
    layer3: { isBreakoutLong, isBreakdownShort, longSetup, shortSetup },
    confluence: conf4h1hLong || conf4h1hShort,
    sr: d4.sr, price: cp, pair: d4.pair, timestamp: d4.timestamp,
  };
}
const POPULAR = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","DOT","MATIC","LINK","LTC","ATOM","UNI","APT"];

function fmt(n, d=4) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: d });
}

// ── STYLES ───────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-tap-highlight-color: transparent; }
  body { background: #080c14; color: #e2e8f0; font-family: 'Space Mono', monospace; overscroll-behavior: none; }
  :root { --g:#00ff88; --c:#00c4ff; --r:#ff5050; --o:#ffb400; --p:#a080ff; --bg:#080c14; }

  .app { min-height:100vh; min-height:100dvh; background:var(--bg);
    background-image: radial-gradient(ellipse 80% 40% at 50% -10%, rgba(0,255,136,0.09) 0%, transparent 60%),
    linear-gradient(180deg,#080c14 0%,#0d1421 100%); display:flex; flex-direction:column; max-width:600px; margin:0 auto; }

  /* HEADER */
  .hdr { padding:12px 16px; border-bottom:1px solid rgba(0,255,136,0.12); display:flex; align-items:center;
    gap:10px; background:rgba(0,0,0,0.5); backdrop-filter:blur(16px); position:sticky; top:0; z-index:100; }
  .logo { width:34px; height:34px; background:linear-gradient(135deg,var(--g),var(--c)); border-radius:9px;
    display:flex; align-items:center; justify-content:center; font-weight:700; font-size:11px;
    color:var(--bg); flex-shrink:0; font-family:'Syne',sans-serif; }
  .hdr-t h1 { font-family:'Syne',sans-serif; font-size:11px; font-weight:800; color:var(--g); letter-spacing:0.04em; line-height:1; }
  .hdr-t p { font-size:8px; color:#3a5060; letter-spacing:0.06em; margin-top:3px; }
  .hdr-r { margin-left:auto; display:flex; align-items:center; gap:5px; }
  .bdg { border-radius:20px; padding:3px 9px; font-size:8px; font-family:'Syne',sans-serif; font-weight:700; }
  .bdg-g { background:rgba(0,255,136,0.12); border:1px solid rgba(0,255,136,0.3); color:var(--g); }
  .bdg-b { background:rgba(0,196,255,0.1); border:1px solid rgba(0,196,255,0.25); color:var(--c); }
  .bdg-p { background:rgba(120,80,255,0.1); border:1px solid rgba(120,80,255,0.25); color:var(--p); }
  .live-i { display:flex; align-items:center; gap:4px; font-size:8px; color:#4a6080; }
  .dot-l { width:6px; height:6px; background:var(--g); border-radius:50%; animation:pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }

  /* COIN INPUT */
  .coin-sec { padding:12px 14px 10px; border-bottom:1px solid rgba(0,255,136,0.08); background:rgba(0,0,0,0.2); }
  .sec-lbl { font-size:8px; color:#3a5060; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:7px; }
  .coin-row { display:flex; gap:7px; align-items:center; margin-bottom:9px; }
  .coin-inp { flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(0,255,136,0.2); border-radius:10px;
    padding:10px 13px; font-size:15px; font-weight:700; color:var(--g); font-family:'Syne',sans-serif;
    outline:none; letter-spacing:0.08em; text-transform:uppercase; transition:border-color 0.2s; }
  .coin-inp::placeholder { color:#2a4055; font-size:11px; font-weight:400; text-transform:none; }
  .coin-inp:focus { border-color:rgba(0,255,136,0.5); box-shadow:0 0 0 3px rgba(0,255,136,0.06); }
  .ana-btn { background:linear-gradient(135deg,var(--g),var(--c)); border:none; border-radius:10px; padding:10px 16px;
    font-size:12px; font-weight:700; color:var(--bg); font-family:'Syne',sans-serif; cursor:pointer;
    transition:all 0.2s; white-space:nowrap; letter-spacing:0.04em; }
  .ana-btn:active { transform:scale(0.96); }
  .ana-btn:disabled { opacity:0.4; cursor:not-allowed; }
  .pop-c { display:flex; gap:5px; flex-wrap:wrap; }
  .c-chip { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:5px;
    padding:4px 10px; font-size:10px; color:#5a7080; cursor:pointer; transition:all 0.15s;
    font-family:'Syne',sans-serif; font-weight:600; }
  .c-chip.active { background:rgba(0,255,136,0.12); border-color:rgba(0,255,136,0.5); color:var(--g); }
  .fetch-s { display:flex; align-items:center; gap:7px; font-size:10px; color:#4a6080; padding:6px 0; }
  .spin { width:13px; height:13px; border:2px solid rgba(0,255,136,0.2); border-top-color:var(--g);
    border-radius:50%; animation:spin 0.8s linear infinite; flex-shrink:0; }
  @keyframes spin { to { transform:rotate(360deg); } }

  /* LIVE CARD */
  .live-card { margin:10px 14px 0; background:rgba(0,0,0,0.35); border:1px solid rgba(0,255,136,0.1); border-radius:12px; overflow:hidden; }
  .lc-hdr { display:flex; align-items:center; justify-content:space-between; padding:9px 13px; border-bottom:1px solid rgba(255,255,255,0.05); }
  .lc-pair { font-family:'Syne',sans-serif; font-size:14px; font-weight:800; color:#fff; }
  .lc-price { font-family:'Syne',sans-serif; font-size:16px; font-weight:800; color:var(--g); }
  .lc-src { font-size:8px; color:#3a5060; margin-top:2px; }
  .lc-tabs { display:flex; border-bottom:1px solid rgba(255,255,255,0.05); }
  .lc-tab { flex:1; padding:8px 4px; font-size:9px; font-family:'Syne',sans-serif; font-weight:600;
    letter-spacing:0.05em; text-align:center; cursor:pointer; color:#3a5060; border:none; background:none; transition:all 0.2s; }
  .lc-tab.active { color:var(--g); border-bottom:2px solid var(--g); background:rgba(0,255,136,0.04); }
  .lc-body { padding:10px 13px; }
  .dg { display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:8px; }
  .dc { background:rgba(255,255,255,0.025); border-radius:6px; padding:6px 8px; }
  .dc-l { font-size:8px; color:#3a5060; letter-spacing:0.07em; text-transform:uppercase; margin-bottom:3px; }
  .dc-v { font-size:10px; font-weight:700; color:#c8d8e8; }
  .dc-v.g{color:var(--g)} .dc-v.r{color:var(--r)} .dc-v.o{color:var(--o)} .dc-v.b{color:var(--c)}
  .sp { border-radius:5px; padding:3px 9px; font-size:10px; font-weight:700; font-family:'Syne',sans-serif; display:inline-flex; align-items:center; gap:4px; }
  .sp-g { background:rgba(0,255,136,0.1); border:1px solid rgba(0,255,136,0.3); color:var(--g); }
  .sp-r { background:rgba(255,80,80,0.1); border:1px solid rgba(255,80,80,0.3); color:var(--r); }
  .sp-b { background:rgba(0,196,255,0.1); border:1px solid rgba(0,196,255,0.25); color:var(--c); }
  .sp-n { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:#5a7080; }
  .sr-row { display:flex; gap:5px; flex-wrap:wrap; margin-bottom:5px; }
  .sr-r { background:rgba(255,80,80,0.08); border:1px solid rgba(255,80,80,0.2); border-radius:4px; padding:2px 8px; font-size:9px; font-weight:700; color:#ff7070; }
  .sr-s { background:rgba(0,255,136,0.07); border:1px solid rgba(0,255,136,0.2); border-radius:4px; padding:2px 8px; font-size:9px; font-weight:700; color:#00cc70; }

  /* ═══ DECISION CARD — UTAMA ═══ */
  .decision-wrap { margin:12px 14px 0; }

  .dec-card { border-radius:14px; padding:16px; border:2px solid; }
  .dec-LONG  { background:linear-gradient(135deg,rgba(0,255,136,0.08),rgba(0,196,255,0.04)); border-color:rgba(0,255,136,0.5); }
  .dec-SHORT { background:linear-gradient(135deg,rgba(255,80,80,0.08),rgba(255,120,80,0.04)); border-color:rgba(255,80,80,0.5); }
  .dec-WAIT  { background:linear-gradient(135deg,rgba(255,180,0,0.06),rgba(255,140,0,0.03)); border-color:rgba(255,180,0,0.35); }

  .dec-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
  .dec-signal { display:flex; align-items:center; gap:10px; }
  .dec-badge { font-family:'Syne',sans-serif; font-size:26px; font-weight:800; letter-spacing:0.06em; line-height:1; }
  .dec-badge.LONG{color:var(--g)} .dec-badge.SHORT{color:var(--r)} .dec-badge.WAIT{color:var(--o)}
  .dec-sub { font-size:9px; color:#4a6080; margin-top:3px; letter-spacing:0.08em; }
  .conf-wrap { text-align:right; }
  .conf-num { font-family:'Syne',sans-serif; font-size:22px; font-weight:800; }
  .conf-num.LONG{color:var(--g)} .conf-num.SHORT{color:var(--r)} .conf-num.WAIT{color:var(--o)}
  .conf-lbl { font-size:8px; color:#3a5060; letter-spacing:0.08em; }
  .conf-bar-wrap { width:60px; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden; margin:4px 0 0 auto; }
  .conf-bar-fill { height:100%; border-radius:2px; transition:width 1.2s ease; }
  .fill-LONG{background:linear-gradient(90deg,var(--g),var(--c))}
  .fill-SHORT{background:linear-gradient(90deg,var(--r),#ff8080)}
  .fill-WAIT{background:linear-gradient(90deg,var(--o),#ffcc44)}

  /* LAYER CHECKLIST */
  .layer-list { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
  .layer-item { display:flex; gap:9px; align-items:flex-start; font-size:11px; color:#8899aa; line-height:1.5; }
  .layer-icon { width:20px; height:20px; border-radius:5px; display:flex; align-items:center;
    justify-content:center; font-size:10px; flex-shrink:0; margin-top:1px; }
  .li-pass { background:rgba(0,255,136,0.15); color:var(--g); }
  .li-fail { background:rgba(255,80,80,0.15); color:var(--r); }
  .li-warn { background:rgba(255,180,0,0.15); color:var(--o); }

  /* PRICE BOXES */
  .price-boxes { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
  .pb { border-radius:10px; padding:10px 12px; }
  .pb-entry { background:rgba(0,196,255,0.06); border:1px solid rgba(0,196,255,0.25); }
  .pb-sl { background:rgba(255,80,80,0.06); border:1px solid rgba(255,80,80,0.25); }
  .pb-tp { background:rgba(0,255,136,0.06); border:1px solid rgba(0,255,136,0.25); grid-column:1/-1; }
  .pb-lbl { font-size:8px; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:4px; }
  .pb-entry .pb-lbl{color:var(--c)} .pb-sl .pb-lbl{color:var(--r)} .pb-tp .pb-lbl{color:var(--g)}
  .pb-val { font-family:'Syne',sans-serif; font-size:16px; font-weight:800; }
  .pb-entry .pb-val{color:#e2e8f0} .pb-sl .pb-val{color:var(--r)} .pb-tp .pb-val{color:var(--g); font-size:20px;}
  .pb-note { font-size:9px; color:#4a6080; margin-top:3px; }

  /* RR STRIP */
  .rr-strip { background:rgba(255,180,0,0.07); border:1px solid rgba(255,180,0,0.25); border-radius:8px;
    padding:9px 12px; display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
  .rr-big { font-family:'Syne',sans-serif; font-size:18px; font-weight:800; color:var(--o); }
  .rr-detail { font-size:10px; color:#6a8099; text-align:right; line-height:1.6; }

  /* WAIT REASONS */
  .wait-box { border-radius:10px; padding:12px 14px; background:rgba(255,180,0,0.06); border:1px solid rgba(255,180,0,0.2); }
  .wait-title { font-family:'Syne',sans-serif; font-size:10px; font-weight:700; color:var(--o); letter-spacing:0.08em; margin-bottom:8px; }
  .wait-item { display:flex; gap:8px; font-size:11px; color:#8899aa; line-height:1.5; margin-bottom:6px; }
  .wait-item:last-child { margin-bottom:0; }

  /* CONFLUENCE STRIP */
  .conf-strip { border-radius:8px; padding:9px 12px; display:flex; align-items:center; gap:8px;
    font-size:11px; color:#8899aa; margin-bottom:10px; }
  .conf-strip.yes { background:rgba(0,255,136,0.06); border:1px solid rgba(0,255,136,0.2); }
  .conf-strip.no  { background:rgba(255,180,0,0.05); border:1px solid rgba(255,180,0,0.15); }

  /* MESSAGES */
  .msgs { flex:1; overflow-y:auto; padding:12px 14px; display:flex; flex-direction:column; gap:11px;
    -webkit-overflow-scrolling:touch; scrollbar-width:thin; scrollbar-color:rgba(0,255,136,0.2) transparent; }
  .msg { display:flex; gap:8px; animation:fadeUp 0.3s ease; }
  @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .msg.user { flex-direction:row-reverse; }
  .av { width:26px; height:26px; border-radius:7px; flex-shrink:0; display:flex; align-items:center;
    justify-content:center; font-size:9px; font-weight:700; margin-top:2px; }
  .av-a { background:linear-gradient(135deg,var(--g),var(--c)); color:var(--bg); font-family:'Syne',sans-serif; }
  .av-u { background:rgba(255,255,255,0.08); color:#8899aa; }
  .mc { max-width:88%; }
  .bbl { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); border-radius:12px;
    padding:10px 13px; font-size:12px; line-height:1.7; color:#c8d8e8; }
  .msg.user .bbl { background:rgba(0,255,136,0.07); border-color:rgba(0,255,136,0.15); color:#e2e8f0; }

  /* LOADING */
  .ldm { display:flex; gap:8px; align-items:flex-start; }
  .ldd { display:flex; gap:4px; padding:12px 14px; background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.06); border-radius:12px; }
  .ld { width:5px; height:5px; background:var(--g); border-radius:50%; animation:bounce 1.2s infinite; }
  .ld:nth-child(2){animation-delay:0.2s} .ld:nth-child(3){animation-delay:0.4s}
  @keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-6px);opacity:1} }

  /* INPUT */
  .inp-a { padding:9px 14px 16px; border-top:1px solid rgba(0,255,136,0.08); background:rgba(0,0,0,0.3); }
  .inp-r { display:flex; gap:7px; align-items:flex-end; }
  .iw { flex:1; background:rgba(255,255,255,0.04); border:1px solid rgba(0,255,136,0.12);
    border-radius:10px; overflow:hidden; transition:border-color 0.2s; }
  .iw:focus-within { border-color:rgba(0,255,136,0.35); }
  .ti { width:100%; background:none; border:none; outline:none; padding:10px 12px; font-size:13px;
    color:#e2e8f0; font-family:'Space Mono',monospace; resize:none; max-height:80px; line-height:1.5; }
  .ti::placeholder { color:#1e3040; }
  .sb { width:42px; height:42px; background:linear-gradient(135deg,var(--g),var(--c)); border:none;
    border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center;
    flex-shrink:0; transition:transform 0.15s; }
  .sb:active { transform:scale(0.92); }
  .sb:disabled { opacity:0.35; cursor:not-allowed; transform:none; }
  .hint { font-size:9px; color:#1a2f40; margin-top:7px; }

  /* WELCOME */
  .welcome { background:linear-gradient(135deg,rgba(0,255,136,0.05),rgba(0,196,255,0.03));
    border:1px solid rgba(0,255,136,0.15); border-radius:14px; padding:16px; margin-bottom:4px; }
  .welcome h2 { font-family:'Syne',sans-serif; font-size:15px; font-weight:800; color:#fff; margin-bottom:6px; }
  .welcome h2 span { color:var(--g); }
  .welcome p { font-size:11px; color:#6a8099; line-height:1.6; margin-bottom:10px; }
  .flow { display:flex; flex-direction:column; gap:6px; }
  .flow-item { display:flex; gap:8px; align-items:center; font-size:10px; color:#6a8099; }
  .flow-n { width:20px; height:20px; border-radius:5px; background:rgba(0,196,255,0.12);
    color:var(--c); display:flex; align-items:center; justify-content:center; font-size:9px; flex-shrink:0; font-family:'Syne',sans-serif; font-weight:700; }

  ::-webkit-scrollbar { width:3px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:rgba(0,255,136,0.15); border-radius:2px; }
`;

// ── LIVE DATA CARD ────────────────────────────────────────────────
function LiveCard({ d4, d1 }) {
  const [tab, setTab] = useState("ma");
  if (!d4) return null;
  return (
    <div className="live-card">
      <div className="lc-hdr">
        <div>
          <div className="lc-pair">{d4.pair}</div>
          <div className="lc-src">BingX Futures · {new Date(d4.timestamp).toLocaleTimeString("id-ID")}</div>
        </div>
        <div className="lc-price">${fmt(d4.currentPrice)}</div>
      </div>
      <div className="lc-tabs">
        {[["ma","MA + VMC"],["sr","S&R"]].map(([k,v])=>(
          <button key={k} className={`lc-tab${tab===k?" active":""}`} onClick={()=>setTab(k)}>{v}</button>
        ))}
      </div>
      <div className="lc-body">
        {tab==="ma" && <>
          <div style={{fontSize:"8px",color:"#3a5060",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"6px"}}>4H ▸ Trend</div>
          <div className="dg">
            <div className="dc"><div className="dc-l">MA 13</div><div className="dc-v">{d4.ma13}</div></div>
            <div className="dc"><div className="dc-l">MA 21</div><div className="dc-v">{d4.ma21}</div></div>
            <div className="dc" style={{gridColumn:"1/-1"}}><div className="dc-l">Status 4H</div>
              <span className={`sp ${d4.trendBullish?"sp-g":"sp-r"}`}>{d4.trendBullish?"▲ BULLISH":"▼ BEARISH"}</span>
            </div>
            <div className="dc"><div className="dc-l">VMC Dot</div>
              <span className={`sp ${d4.vmc?.dot Pacify === "GREEN" ? "sp-g" : d4.vmc?.dot === "RED" ? "sp-r" : "sp-n"}`}>{d4.vmc?.dot==="GREEN"?"● HIJAU":d4.vmc?.dot==="RED"?"● MERAH":"◌ NONE"}</span>
            </div>
            <div className="dc"><div className="dc-l">Money Flow</div>
              <div className={`dc-v ${d4.vmc?.moneyFlow>0?"g":"r"}`}>{d4.vmc?.moneyFlow>0?"+":""}{d4.vmc?.moneyFlow}</div>
            </div>
          </div>
          {d1 && <>
            <div style={{fontSize:"8px",color:"#3a5060",letterSpacing:"0.08em",textTransform:"uppercase",margin:"8px 0 6px"}}>1H ▸ Entry Timing</div>
            <div className="dg">
              <div className="dc"><div className="dc-l">Status 1H</div>
                <span className={`sp ${d1.trendBullish?"sp-g":"sp-r"}`}>{d1.trendBullish?"▲ BULLISH":"▼ BEARISH"}</span>
              </div>
              <div className="dc"><div className="dc-l">Money Flow</div>
                <div className={`dc-v ${d1.vmc?.moneyFlow>0?"g":"r"}`}>{d1.vmc?.moneyFlow>0?"+":""}{d1.vmc?.moneyFlow}</div>
              </div>
            </div>
          </=></>}
        </>}
        {tab==="sr" && <>
          <div style={{fontSize:"8px",color:"#ff7070",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>🔴 Resistance</div>
          <div className="sr-row">{d4.sr?.resistanceLevels?.length ? d4.sr.resistanceLevels.map((r,i)=><span key={i} className="sr-r">R{i+1}: ${fmt(r)}</span>) : <span style={{fontSize:"10px",color:"#3a5060"}}>—</span>}</div>
          <div style={{fontSize:"8px",color:"#00cc70",letterSpacing:"0.08em",textTransform:"uppercase",margin:"8px 0 5px"}}>🟢 Support</div>
          <div className="sr-row">{d4.sr?.supportLevels?.length ? d4.sr.supportLevels.map((s,i)=><span key={i} className="sr-s">S{i+1}: ${fmt(s)}</span>) : <span style={{fontSize:"10px",color:"#3a5060"}}>—</span>}</div>
        </>}
      </div>
    </div>
  );
}

// ── DECISION CARD — KOMPONEN UTAMA ────────────────────────────────
function DecisionCard({ dec }) {
  const [fw, setFw] = useState(0);
  useEffect(()=>{ setTimeout(()=>setFw(dec.confidence),200); },[dec.confidence]);

  return (
    <div className="decision-wrap">
      <div className={`dec-card dec-${dec.signal}`}>
        {/* TOP: SIGNAL + CONFIDENCE */}
        <div className="dec-top">
          <div className="dec-signal">
            <div>
              <div className={`dec-badge ${dec.signal}`}>
                {dec.signal==="LONG"&&"▲ LONG"}{dec.signal==="SHORT"&&"▼ SHORT"}{dec.signal==="WAIT"&&"◆ TUNGGU"}
              </div>
              <div className="dec-sub">
                {dec.signal==="LONG"&&"BUKA POSISI BUY"}
                {dec.signal==="SHORT"&&"BUKA POSISI SELL"}
                {dec.signal==="WAIT"&&"JANGAN ENTRY SEKARANG"}
              </div>
            </div>
          </div>
          <div className="conf-wrap">
            <div className={`conf-num ${dec.signal}`}>{dec.confidence}%</div>
            <div className="conf-lbl">CONFIDENCE</div>
            <div className="conf-bar-wrap">
              <div className={`conf-bar-fill fill-${dec.signal}`} style={{width:`${fw}%`}}/>
            </div>
          </div>
        </div>

        {/* CONFLUENCE */}
        {dec.signal !== "WAIT" && (
          <div className={`conf-strip ${dec.confluence?"yes":"no"}`}>
            <span style={{fontSize:"14px"}}>{dec.confluence?"⚡":"⚠️"}</span>
            <span style={{fontSize:"11px",color:dec.confluence?"#00ff88":"#ffb400"}}>
              {dec.confluence ? "KONFLUENSI KUAT — 4H & 1H sama arah" : "KONFLUENSI PARSIAL — hanya 4H terkonfirmasi"}
            </span>
          </div>
        )}

        {/* 3-LAYER CHECKLIST */}
        <div className="layer-list">
          {dec.reasons.map((r,i)=>{
            const isPass = r.startsWith("✅");
            const isWarn = r.startsWith("⚠️");
            return (
              <div key={i} className="layer-item">
                <div className={`layer-icon ${isPass?"li-pass":isWarn?"li-warn":"li-fail"}`}>
                  {isPass?"✓":isWarn?"!":"✗"}
                </div>
                <span>{r.replace(/^[✅⚠️❌]\s*/,"")}</span>
              </div>
            );
          })}
        </div>

        {/* S&R CONTEXT — selalu tampil */}
        {dec.priceContext?.length > 0 && (
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
            {dec.priceContext.map((c,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
                borderRadius:"6px",padding:"5px 10px",fontSize:"9px",color:"#6a8099",lineHeight:"1.4"}}>
                {c}
              </div>
            ))}
          </div>
        )}

        {/* PRICE BOXES — hanya jika LONG/SHORT */}
        {dec.signal !== "WAIT" && dec.setup && <>
          {/* ENTRY NOTE — penjelasan posisi entry vs S&R */}
          <div style={{background:"rgba(0,196,255,0.06)",border:"1px solid rgba(0,196,255,0.2)",
            borderRadius:"8px",padding:"9px 12px",marginBottom:"10px",display:"flex",gap:"8px",alignItems:"center"}}>
            <span style={{fontSize:"16px"}}>{dec.signal==="LONG"?"📍":"📍"}</span>
            <div>
              <div style={{fontSize:"8px",color:"#00c4ff",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"3px"}}>
                POSISI ENTRY — {dec.signal==="LONG"?"1-2% DI ATAS SUPPORT TERKUAT":"1-2% DI BAWAH RESISTANCE TERKUAT"}
              </div>
              <div style={{fontSize:"11px",color:"#c8d8e8",lineHeight:"1.5"}}>
                {dec.setup.entryNote}
              </div>
            </div>
          </div>

          <div className="price-boxes">
            <div className="pb pb-entry">
              <div className="pb-lbl">Entry</div>
              <div className="pb-val">${fmt(dec.setup.entry)}</div>
              <div className="pb-note">{dec.setup.entryNote}</div>
            </div>
            <div className="pb pb-sl">
              <div className="pb-lbl">Stop Loss</div>
              <div className="pb-val">${fmt(dec.setup.sl)}</div>
              <div className="pb-note">2% di {dec.signal==="LONG"?"bawah support":"atas resistance"} ${dec.signal==="LONG"?dec.setup.supportLevel:dec.setup.resistanceLevel}</div>
            </div>
            <div className="pb pb-tp">
              <div className="pb-lbl">Take Profit (Target)</div>
              <div className="pb-val">${fmt(dec.setup.tp)}</div>
              <div className="pb-note">RR 1:3 dari acuan 4H</div>
            </div>
          </div>
          <div className="rr-strip">
            <div><div style={{fontSize:"8px",color:"#4a6080",letterSpacing:"0.1em",marginBottom:"4px"}}>RISK / REWARD</div><div className="rr-big">1 : 3</div></div>
            <div className="rr-detail">{dec.setup.rrCalc}</div>
          </div>
        </>}

        {/* WAIT REASONS */}
        {dec.signal === "WAIT" && dec.waitReasons.length > 0 && (
          <div className="wait-box">
            <div className="wait-title">🎯 KENAPA WAIT — TUNGGU KONDISI INI:</div>
            {dec.waitReasons.map((r,i)=>(
              <div key={i} className="wait-item">
                <span style={{color:"#ffb400",flexShrink:0}}>→</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SCREENER ─────────────────────────────────────────────────────
const TOP_100_COINS = [
  "BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","LINK","DOT",
  "HYPE","LTC","NEAR","OP","ARB","INJ","RNDR","APT","SUI","SEI",
  "FET","GALA","SAND","MANA","FTM","WLD","TIA","PEPE","SHIB","BCH",
  "ETC","FIL","ICP","STX","IMX","GRT","SNX","MKR","AAVE","LDO",
  "RUNE","QNT","ALGO","EGLD","AXS","THETA","KAS","ORDI","1000SATS","BONK",
  "WIF","JUP","PYTH","DYM","MANTA","ALT","STRK","PIXEL","PORTAL","AEVO",
  "ETHFI","ENA","W","TNSR","OMNI","REZ","BB","NOT","IO","ZK",
  "ZRO","BLAST","RENDER","TON","TRX","XLM","XMR","VET","AR","HBAR",
  "MNT","CRO","ONDO","PENDLE","JTO","CORE","FLR","KAVA","GMX","CFX",
  "FLOKI","MEME","BOME","MEW","BRETT","POPCAT","MOG","DEGEN","NEIRO","TURBO"
];

function ScreenerTab() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiModel, setAiModel] = useState("deepseek");
  const [tab, setTab] = useState("results");
  const total = TOP_100_COINS.length;
  const priceIntervalRef = useRef(null);

  async function handleScan() {
    if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);

    setLoading(true); setResults([]); setProgress(0); setAiAnalysis(null); setTab("results");
    let tmp = [];
    for (let i = 0; i < total; i += 5) {
      const chunk = TOP_100_COINS.slice(i, i + 5);
      const res = await Promise.all(chunk.map(c =>
        fetch(`${BACKEND_URL}/api/screener?coin=${c}`).then(r=>r.json()).catch(()=>null)
      ));
      res.forEach(r => { if (r?.success && r?.data) tmp.push(r.data); });
      tmp.sort((a,b) => parseFloat(a.distanceToTarget) - parseFloat(b.distanceToTarget));
      setResults([...tmp]);
      setProgress(Math.min(i + 5, total));
      await new Promise(r => setTimeout(r, 500));
    }
    setLoading(false);
  }

  // ── FIX 2: AUTO-UPDATE HARGA PASAR SECARA REAL-TIME 5 DETIK ───
  useEffect(() => {
    if (loading || results.length === 0) return;

    const fetchLivePricesForScreener = async () => {
      console.log("🔄 Memperbarui harga pasar di Screener secara Live...");
      
      setResults(prevResults => {
        Promise.all(
          prevResults.map(async (coinData) => {
            try {
              const r = await fetch(`${BACKEND_URL}/api/demo?action=price&symbol=${coinData.coin}&t=${Date.now()}`);
              const d = await r.json();
              if (d && d.price && d.price > 0) {
                const currentPrice = parseFloat(d.price);
                const targetLevel = parseFloat(coinData.targetLevel);
                let distanceToTarget = coinData.distanceToTarget;
                
                if (targetLevel > 0) {
                  const dist = Math.abs(targetLevel - currentPrice) / targetLevel;
                  distanceToTarget = (dist * 100).toFixed(2);
                }

                return {
                  ...coinData,
                  currentPrice: currentPrice.toFixed(4),
                  distanceToTarget: distanceToTarget
                };
              }
            } catch (err) {
              console.error(`Gagal realtime update untuk ${coinData.coin}:`, err);
            }
            return coinData;
          })
        ).then(updatedResults => {
          updatedResults.sort((a,b) => parseFloat(a.distanceToTarget) - parseFloat(b.distanceToTarget));
          
          if (JSON.stringify(prevResults) !== JSON.stringify(updatedResults)) {
            setResults(updatedResults);
          }
        });

        return prevResults;
      });
    };

    priceIntervalRef.current = setInterval(fetchLivePricesForScreener, 5000);

    return () => {
      if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
    };
  }, [loading, results.length]);

  async function handleAI() {
    if (!results.length) return;
    setAiLoading(true); setAiAnalysis(null); setTab("ai");
    try {
      const r = await fetch(`${BACKEND_URL}/api/screener-ai`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ results, model: aiModel }),
      });
      const d = await r.json();
      setAiAnalysis(d.error ? { error: d.error } : d);
    } catch(e) { setAiAnalysis({ error: e.message }); }
    finally { setAiLoading(false); }
  }

  const pct = ((progress/total)*100).toFixed(0);
  const readyCount = results.filter(r=>r.status==="READY").length;
  const a = aiAnalysis?.analysis;

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* TOP BAR */}
      <div style={{padding:"12px 14px",borderBottom:"1px solid rgba(0,255,136,0.08)",background:"rgba(0,0,0,0.25)",display:"flex",flexDirection:"column",gap:"8px"}}>
        <button onClick={handleScan} disabled={loading}
          style={{width:"100%",background:"linear-gradient(135deg,#00ff88,#00c4ff)",border:"none",borderRadius:"10px",padding:"12px",fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"12px",color:"#080c14",cursor:loading?"not-allowed":"pointer"}}>
          {loading ? `⏳ Memindai... ${progress}/${total} (${pct}%)` : `🔍 Scan ${total} Coin Sekarang`}
        </button>

        {(loading || progress > 0) && (
          <div>
            <div style={{width:"100%",height:"3px",background:"rgba(255,255,255,0.08)",borderRadius:"2px",overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#00ff88,#00c4ff)",transition:"width 0.3s"}}/>
            </div>
            <div style={{fontSize:"9px",color:"#4a6080",marginTop:"3px",display:"flex",justifyContent:"space-between"}}>
              <span>{progress}/{total} coin dipindai</span>
              <span style={{color:"#00ff88"}}>{readyCount} READY ditemukan</span>
            </div>
          </div>
        )}

        {results.length > 0 && !loading && (
          <div style={{display:"flex",gap:"7px",alignItems:"center"}}>
            <div style={{display:"flex",gap:"5px"}}>
              {[["deepseek","🧠 DS","#00c4ff"],["hermes","🔮 H3","#a080ff"]].map(([id,lbl,col])=>(
                <button key={id} onClick={()=>setAiModel(id)}
                  style={{padding:"7px 10px",borderRadius:"7px",cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"10px",border:`1px solid ${aiModel===id?col:"rgba(255,255,255,0.08)"}`,background:aiModel===id?`rgba(${id==="deepseek"?"0,196,255":"160,128,255"},0.1)`:"rgba(255,255,255,0.03)",color:aiModel===id?col:"#5a7080",transition:"all 0.2s"}}>
                  {lbl}
                </button>
              ))}
            </div>
            <button onClick={handleAI} disabled={aiLoading}
              style={{flex:1,padding:"8px 12px",background:"linear-gradient(135deg,#a080ff,#6040cc)",border:"none",borderRadius:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"11px",color:"#fff",cursor:aiLoading?"not-allowed":"pointer",opacity:aiLoading?0.7:1,transition:"opacity 0.2s"}}>
              {aiLoading ? "⏳ AI Menganalisis..." : `🤖 Analisis AI (${results.length} coin)`}
            </button>
          </div>
        )}
      </div>

      {/* TABS */}
      {results.length > 0 && (
        <div style={{display:"flex",borderBottom:"1px solid rgba(0,255,136,0.08)",background:"rgba(0,0,0,0.2)"}}>
          {[["results",`📋 Hasil (${results.length})`],["ai","🤖 AI Analysis"]].map(([k,v])=>(
            <button key={k} style={{flex:1,padding:"8px",fontSize:"9px",fontFamily:"'Syne',sans-serif",fontWeight:"700",textAlign:"center",cursor:"pointer",color:tab===k?"#00ff88":"#3a5060",border:"none",background:"none",borderBottom:tab===k?"2px solid #00ff88":"none",textTransform:"uppercase",transition:"all 0.2s"}}
              onClick={()=>setTab(k)}>{v}</button>
          ))}
        </div>
      )}

      {/* RESULTS */}
      {tab==="results" && (
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:"10px"}}>
          {!results.length && !loading && (
            <div style={{textAlign:"center",padding:"40px 20px",color:"#3a5060",fontSize:"12px",lineHeight:"2"}}>
              Klik Scan untuk memindai {total} coin sekaligus<br/>
              <span style={{fontSize:"10px"}}>Mencari coin yang sudah Breakout atau mendekati level S&R</span>
            </div>
          )}
          {results.map((r, i) => {
            const ready = r.status === "READY";
            return (
              <div key={i} style={{background:ready?"rgba(0,255,136,0.06)":"rgba(255,180,0,0.05)",border:`1px solid ${ready?"rgba(0,255,136,0.3)":"rgba(255,180,0,0.2)"}`,borderRadius:"12px",padding:"13px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"9px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"15px",color:"#fff"}}>{r.coin}</span>
                    <span style={{background:r.signal==="LONG"?"rgba(0,255,136,0.12)":"rgba(255,80,80,0.12)",color:r.signal==="LONG"?"#00ff88":"#ff5050",padding:"2px 8px",borderRadius:"5px",fontSize:"9px",fontWeight:"800",fontFamily:"'Syne',sans-serif",border:`1px solid ${r.signal==="LONG"?"rgba(0,255,136,0.3)":"rgba(255,80,80,0.3)"}`}}>
                      {r.signal==="LONG"?"▲ LONG":"▼ SHORT"}
                    </span>
                  </div>
                  <div style={{background:ready?"rgba(0,255,136,0.15)":"rgba(255,180,0,0.12)",color:ready?"#00ff88":"#ffb400",padding:"3px 9px",borderRadius:"6px",fontSize:"9px",fontWeight:"800",fontFamily:"'Syne',sans-serif"}}>
                    {ready?"🎯 READY":"👁️ WATCH"}
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"8px"}}>
                  {[["Harga",`$${r.currentPrice}`,"#e2e8f0"],["Target",`$${r.targetLevel}`,r.signal==="LONG"?"#00c4ff":"#ff7070"]].map(([l,v,c])=>(
                    <div key={l} style={{background:"rgba(0,0,0,0.2)",padding:"7px 9px",borderRadius:"7px"}}>
                      <div style={{fontSize:"8px",color:"#4a6080",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:"3px"}}>{l}</div>
                      <div style={{fontSize:"13px",fontFamily:"'Syne',sans-serif",fontWeight:"800",color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:"10px",color:"#8899aa",background:"rgba(255,255,255,0.03)",padding:"7px 9px",borderRadius:"7px",lineHeight:"1.5"}}>
                  <span style={{color:ready?"#00ff88":"#ffb400",marginRight:"4px"}}>↳</span>{r.details}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI TAB */}
      {tab==="ai" && (
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px"}}>
          {aiLoading && (
            <div style={{textAlign:"center",padding:"50px 20px"}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"14px",color:"#a080ff",marginBottom:"8px"}}>🤖 AI Sedang Menganalisis</div>
              <div style={{fontSize:"11px",color:"#3a5060"}}>Memproses {results.length} hasil scan...</div>
            </div>
          )}
          {!aiLoading && aiAnalysis?.error && (
            <div style={{background:"rgba(255,80,80,0.06)",border:"1px solid rgba(255,80,80,0.2)",borderRadius:"10px",padding:"14px",color:"#ff5050",fontSize:"12px"}}>❌ {aiAnalysis.error}</div>
          )}
          {!aiLoading && !aiAnalysis && (
            <div style={{textAlign:"center",padding:"40px 20px",color:"#3a5060",fontSize:"12px",lineHeight:"2"}}>
              Klik <strong style={{color:"#a080ff"}}>🤖 Analisis AI</strong> di atas<br/>setelah scan selesai
            </div>
          )}
          {!aiLoading && a && (
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>

              {/* OVERVIEW */}
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"12px",padding:"13px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
                  <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"13px",color:"#fff"}}>📊 Market Overview</span>
                  <span style={{padding:"4px 11px",borderRadius:"20px",fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"9px",
                    background:a.marketBias==="BULLISH"?"rgba(0,255,136,0.15)":a.marketBias==="BEARISH"?"rgba(255,80,80,0.15)":"rgba(255,180,0,0.15)",
                    color:a.marketBias==="BULLISH"?"#00ff88":a.marketBias==="BEARISH"?"#ff5050":"#ffb400",
                    border:`1px solid ${a.marketBias==="BULLISH"?"rgba(0,255,136,0.3)":a.marketBias==="BEARISH"?"rgba(255,80,80,0.3)":"rgba(255,180,0,0.3)"}`}}>
                    {a.marketBias==="BULLISH"?"▲ BULLISH":a.marketBias==="BEARISH"?"▼ BEARISH":"↕ MIXED"}
                  </span>
                </div>
                <div style={{fontSize:"12px",color:"#8899aa",lineHeight:"1.7",marginBottom:"10px"}}>{a.marketOverview}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"5px"}}>
                  {[["Dipindai",aiAnalysis.stats?.total,"#c8d8e8"],["READY",aiAnalysis.stats?.ready,"#00ff88"],["LONG",aiAnalysis.stats?.longReady,"#00c4ff"],["SHORT",aiAnalysis.stats?.shortReady,"#ff5050"]].map(([l,v,c])=>(
                    <div key={l} style={{background:"rgba(0,0,0,0.25)",borderRadius:"7px",padding:"8px",textAlign:"center"}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"17px",color:c}}>{v}</div>
                      <div style={{fontSize:"8px",color:"#4a6080",marginTop:"2px"}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* TOP PICK */}
              {a.topPick && (
                <div style={{background:"linear-gradient(135deg,rgba(0,255,136,0.07),rgba(0,196,255,0.04))",border:"2px solid rgba(0,255,136,0.35)",borderRadius:"12px",padding:"14px"}}>
                  <div style={{fontSize:"9px",color:"#00ff88",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>⭐ Top Pick</div>
                  <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"24px",color:"#fff"}}>{a.topPick.coin}</span>
                    <span style={{padding:"3px 10px",borderRadius:"6px",fontSize:"10px",fontWeight:"800",fontFamily:"'Syne',sans-serif",background:a.topPick.signal==="LONG"?"rgba(0,255,136,0.12)":"rgba(255,80,80,0.12)",color:a.topPick.signal==="LONG"?"#00ff88":"#ff5050",border:`1px solid ${a.topPick.signal==="LONG"?"rgba(0,255,136,0.3)":"rgba(255,80,80,0.3)"}`}}>
                      {a.topPick.signal==="LONG"?"▲ LONG":"▼ SHORT"}
                    </span>
                    <div style={{marginLeft:"auto",textAlign:"right"}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"20px",color:"#00ff88"}}>{a.topPick.confidence}%</div>
                      <div style={{fontSize:"8px",color:"#4a6080"}}>CONF</div>
                    </div>
                  </div>
                  {a.topPick.entry && <div style={{background:"rgba(0,196,255,0.06)",border:"1px solid rgba(0,196,255,0.2)",borderRadius:"7px",padding:"8px 10px",marginBottom:"9px",fontSize:"10px",color:"#8899aa"}].map(([l,v])=><div key={l}><span style={{color:"#00c4ff",fontWeight:"700"}}>Entry: </span>{v}</div>)}</div>}
                  <div style={{fontSize:"11px",color:"#8899aa",lineHeight:"1.7"}}>{a.topPick.fullAnalysis}</div>
                </div>
              )}

              {/* TOP 3 */}
              {a.top3?.length > 0 && (
                <div>
                  <div style={{fontSize:"9px",color:"#ffb400",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"7px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>🏆 Top 3 Pilihan</div>
                  {a.top3.map((t,i)=>(
                    <div key={i} style={{background:"rgba(255,180,0,0.04)",border:"1px solid rgba(255,180,0,0.15)",borderRadius:"9px",padding:"10px 12px",marginBottom:"7px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px"}}>
                        <span style={{width:"20px",height:"20px",borderRadius:"50%",background:"rgba(255,180,0,0.15)",color:"#ffb400",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:"700",flexShrink:0}}>{i+1}</span>
                        <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"14px",color:"#fff"}}>{t.coin}</span>
                        <span style={{fontSize:"10px",fontWeight:"700",color:t.signal==="LONG"?"#00ff88":"#ff5050"}}>{t.signal==="LONG"?"▲":"▼"} {t.signal}</span>
                        {t.entry && <span style={{marginLeft:"auto",fontSize:"10px",color:"#4a6080"}}>Entry: ${t.entry}</span>}
                      </div>
                      <div style={{fontSize:"11px",color:"#8899aa",lineHeight:"1.5"}}>{t.reason}</div>
                      {t.riskNote && <div style={{fontSize:"10px",color:"#ffb400",marginTop:"5px"}}>⚠️ {t.riskNote}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* WATCHLIST */}
              {a.watchlist?.length > 0 && (
                <div style={{background:"rgba(0,196,255,0.04)",border:"1px solid rgba(0,196,255,0.15)",borderRadius:"9px",padding:"11px 13px"}}>
                  <div style={{fontSize:"9px",color:"#00c4ff",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>👁️ Watchlist</div>
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                    {a.watchlist.map((c,i)=>(
                      <span key={i} style={{background:"rgba(0,196,255,0.08)",border:"1px solid rgba(0,196,255,0.2)",borderRadius:"5px",padding:"3px 10px",fontSize:"11px",color:"#00c4ff",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* WARNINGS */}
              {a.warnings?.filter(Boolean).length > 0 && (
                <div style={{background:"rgba(255,80,80,0.05)",border:"1px solid rgba(255,80,80,0.2)",borderRadius:"9px",padding:"11px 13px"}}>
                  <div style={{fontSize:"9px",color:"#ff5050",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>⚠️ Peringatan</div>
                  {a.warnings.filter(Boolean).map((w,i)=>(
                    <div key={i} style={{fontSize:"11px",color:"#8899aa",lineHeight:"1.5",marginBottom:"5px",display:"flex",gap:"7px"}}><span style={{color:"#ff5050",flexShrink:0}}>→</span><span>{w}</span></div>
                  ))}
                </div>
              )}

              {/* SUMMARY */}
              {a.summary && (
                <div style={{background:"linear-gradient(135deg,rgba(120,80,255,0.06),rgba(0,196,255,0.03))",border:"1px solid rgba(120,80,255,0.2)",borderRadius:"9px",padding:"12px 13px"}}>
                  <div style={{fontSize:"9px",color:"#a080ff",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"6px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>💡 Kesimpulan</div>
                  <div style={{fontSize:"12px",color:"#c8d8e8",lineHeight:"1.6"}}>{a.summary}</div>
                </div>
              )}

              <div style={{fontSize:"8px",color:"#2a4050",textAlign:"center",paddingBottom:"8px"}}>
                Dianalisis oleh {aiAnalysis.model} · {new Date().toLocaleTimeString("id-ID")}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DEMO TRADING COMPONENT ───────────────────────────────────────
function DemoTrading({ decision, d4 }) {
  const BACKEND = "https://trading-backend-nu.vercel.app";
  const [positions, setPositions] = useState([]);
  const [stats, setStats] = useState({ wins:0, losses:0, winRate:0, totalPnl:0, open:0 });
  const [patterns, setPatterns] = useState([]);
  const [aiInsight, setAiInsight] = useState(null);
  const [prices, setPrices] = useState({});
  const [openModal, setOpenModal] = useState(false);
  const [learnLoading, setLearnLoading] = useState(false);
  const [demoTab, setDemoTab] = useState("open"); // open | history | insight
  const [form, setForm] = useState({ coin:"BTC", direction:"LONG", size:"100", notes:"" });
  const priceRef = useRef(null);

  useEffect(() => {
    loadPositions();
  }, []);

  useEffect(() => {
    const openPos = positions.filter(p => p.status === "open");
    if (openPos.length === 0) return;
    const coins = [...new Set(openPos.map(p => p.coin))];
    const fetchPrices = async () => {
      console.log("🔄 Memperbarui harga pasar..."); 
      
      for (const coin of coins) {
        try {
          const url = `${BACKEND}/api/demo?action=price&symbol=${coin}&t=${Date.now()}`;
          const r = await fetch(url);
          const d = await r.json();
          
          if (d && d.price) {
            console.log(`✅ ${coin}: $${d.price}`);
            setPrices(prev => ({ ...prev, [coin]: d.price }));
          }
        } catch (err) {
          console.error(`❌ Gagal update harga ${coin}:`, err);
        }
      }
    };
    fetchPrices();
    priceRef.current = setInterval(fetchPrices, 5000);
    return () => clearInterval(priceRef.current);
  }, [positions]);

  async function loadPositions() {
    try {
      const r = await fetch(`${BACKEND}/api/demo?action=list`);
      const d = await r.json();
      setPositions(d.positions || []);
      setStats(d.stats || {});
      setPatterns(d.patterns || []);
    } catch {}
  }

  async function openPosition() {
    const entry = decision?.setup?.entry || d4?.currentPrice;
    const sl    = decision?.setup?.sl;
    const tp    = decision?.setup?.tp;
    if (!entry) return alert("Lakukan analisis coin dulu");

    const indicators = {
      maPosition:  d4?.maStatus || "",
      vmcDot:      d4?.vmc?.dot || "NONE",
      vmcCircle:   d4?.vmc?.circle || "NONE",
      moneyFlow:   d4?.vmc?.moneyFlow || 0,
      inZone:      decision?.layer2?.inLongZone || decision?.layer2?.inShortZone || false,
      trend4h:     d4?.trendBullish,
      separation:  d4?.maSeparation,
    };

    try {
      const r = await fetch(`${BACKEND}/api/demo?action=open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin:             form.coin,
          direction:        form.direction,
          size:             parseFloat(form.size),
          entryPrice:       parseFloat(entry),
          slPrice:          sl ? parseFloat(sl) : null,
          tpPrice:          tp ? parseFloat(tp) : null,
          indicators,
          signalConfidence: decision?.confidence || 0,
          notes:            form.notes,
        }),
      });
      const d = await r.json();
      if (d.success) { setOpenModal(false); loadPositions(); setDemoTab("open"); }
      else alert(d.error || "Gagal buka posisi");
    } catch(e) { alert(e.message); }
  }

  async function closePosition(pos) {
    const price = prices[pos.coin] || pos.entryPrice;
    const confirm = window.confirm(`Tutup posisi ${pos.direction} ${pos.coin} @ $${price}?\nEstimasi PnL: ${calcLivePnl(pos, price).pnlPct}%`);
    if (!confirm) return;
    try {
      const r = await fetch(`${BACKEND}/api/demo?action=close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pos.id, closePrice: price, closedBy: "MANUAL" }),
      });
      const d = await r.json();
      if (d.success) { loadPositions(); }
    } catch(e) { alert(e.message); }
  }

  async function runLearn() {
    setLearnLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/demo?action=learn`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({}) });
      const d = await r.json();
      if (d.insight) { setAiInsight(d.insight); setDemoTab("insight"); }
      loadPositions();
    } catch(e) { alert(e.message); }
    finally { setLearnLoading(false); }
  }

  function calcLivePnl(pos, currentPrice) {
    const entry = parseFloat(pos.entryPrice);
    const price = parseFloat(currentPrice || pos.currentPrice || entry);
    const pnlPct = pos.direction === "LONG" ? ((price-entry)/entry*100) : ((entry-price)/entry*100);
    const pnlUsd = (pnlPct/100) * parseFloat(pos.size);
    return { pnlPct: pnlPct.toFixed(3), pnlUsd: pnlUsd.toFixed(2) };
  }

  const openPos = positions.filter(p => p.status === "open");
  const closedPos = positions.filter(p => p.status === "closed");

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#080c14"}}>
      {/* STATS BAR */}
      <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(0,255,136,0.1)",background:"rgba(0,0,0,0.3)",display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center"}}>
        {[
          { label:"WIN RATE", value:`${stats.winRate||0}%`, color:"#00ff88" },
          { label:"W/L", value:`${stats.wins||0}/${stats.losses||0}`, color:"#c8d8e8" },
          { label:"OPEN", value:stats.open||0, color:"#00c4ff" },
          { label:"TOTAL PnL", value:`${(stats.totalPnl||0)>=0?"+":""}$${stats.totalPnl||0}`, color:(stats.totalPnl||0)>=0?"#00ff88":"#ff5050" },
        ].map(s=>(
          <div key={s.label} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"6px",padding:"5px 10px",textAlign:"center",flex:1,minWidth:"60px"}}>
            <div style={{fontSize:"8px",color:"#3a5060",letterSpacing:"0.08em",marginBottom:"2px"}}>{s.label}</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"12px",color:s.color}}>{s.value}</div>
          </div>
        ))}
        <button onClick={()=>setOpenModal(true)} style={{background:"linear-gradient(135deg,#00ff88,#00c4ff)",border:"none",borderRadius:"8px",padding:"8px 14px",fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"11px",color:"#080c14",cursor:"pointer",whiteSpace:"nowrap"}}>
          + Open
        </button>
      </div>

      {/* SUB TABS */}
      <div style={{display:"flex",borderBottom:"1px solid rgba(0,255,136,0.08)",background:"rgba(0,0,0,0.2)"}}>
        {[["open",`📈 Open (${openPos.length})`],["history",`📋 History (${closedPos.length})`],["insight","🧠 AI Insight"]].map(([k,v])=>(
          <button key={k} style={{flex:1,padding:"8px 4px",fontSize:"9px",fontFamily:"'Syne',sans-serif",fontWeight:"700",letterSpacing:"0.05em",textAlign:"center",cursor:"pointer",color:demoTab===k?"#00ff88":"#3a5060",border:"none",background:"none",borderBottom:demoTab===k?"2px solid #00ff88":"none",transition:"all 0.2s",textTransform:"uppercase"}}
            onClick={()=>setDemoTab(k)}>{v}</button>
        ))}
      </div>

      {/* OPEN POSITIONS */}
      {demoTab==="open" && (
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:"8px"}}>
          {openPos.length===0 ? (
            <div style={{textAlign:"center",padding:"40px 20px",color:"#3a5060",fontSize:"11px",lineHeight:"2"}}>
              📭 Tidak ada posisi terbuka.<br/>
              Analisis coin dulu di tab Trading,<br/>lalu klik "+ Open" untuk buka posisi demo.
            </div>
          ) : openPos.map(pos => {
            const livePrice = prices[pos.coin] || pos.entryPrice;
            const { pnlPct, pnlUsd } = calcLivePnl(pos, livePrice);
            const isProfit = parseFloat(pnlPct) >= 0;
            return (
              <div key={pos.id} style={{background:isProfit?"rgba(0,255,136,0.05)":"rgba(255,80,80,0.05)",border:`1px solid ${isProfit?"rgba(0,255,136,0.2)":"rgba(255,80,80,0.2)"}`,borderRadius:"10px",padding:"12px 13px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"14px",color:"#fff"}}>{pos.coin}USDT</span>
                    <span style={{borderRadius:"5px",padding:"2px 8px",fontSize:"10px",fontWeight:"700",fontFamily:"'Syne',sans-serif",background:pos.direction==="LONG"?"rgba(0,255,136,0.12)":"rgba(255,80,80,0.12)",color:pos.direction==="LONG"?"#00ff88":"#ff5050",border:`1px solid ${pos.direction==="LONG"?"rgba(0,255,136,0.3)":"rgba(255,80,80,0.3)"}`}}>
                      {pos.direction==="LONG"?"▲ LONG":"▼ SHORT"}
                    </span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"14px",color:isProfit?"#00ff88":"#ff5050"}}>{isProfit?"+":""}{pnlPct}%</div>
                    <div style={{fontSize:"10px",color:isProfit?"#00aa55":"#cc3333"}}>{isProfit?"+":"-"}${Math.abs(pnlUsd)}</div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"5px",marginBottom:"8px"}}>
                  {[["Entry",`$${pos.entryPrice}`,"#c8d8e8"],["Live",`$${livePrice}`,isProfit?"#00ff88":"#ff5050"],["Size",`$${pos.size}`,"#c8d8e8"],["SL",pos.slPrice?`$${pos.slPrice}`:"—","#ff5050"],["TP",pos.tpPrice?`$${pos.tpPrice}`:"—","#00ff88"],["Conf",`${pos.signalConfidence}%`,"#ffb400"]].map(([l,v,c])=>(
                    <div key={l} style={{background:"rgba(0,0,0,0.2)",borderRadius:"5px",padding:"5px 7px"}}>
                      <div style={{fontSize:"8px",color:"#3a5060",marginBottom:"2px"}}>{l}</div>
                      <div style={{fontSize:"10px",fontWeight:"700",color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
                {pos.notes && <div style={{fontSize:"10px",color:"#4a6060",marginBottom:"8px",lineHeight:"1.4"}}>📝 {pos.notes}</div>}
                <button onClick={()=>closePosition(pos)} style={{width:"100%",background:"rgba(255,80,80,0.1)",border:"1px solid rgba(255,80,80,0.3)",borderRadius:"7px",padding:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"11px",color:"#ff5050",cursor:"pointer"}}>
                  ✕ Close Posisi @ ${livePrice}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* HISTORY */}
      {demoTab==="history" && (
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:"7px"}}>
          {closedPos.length===0 ? (
            <div style={{textAlign:"center",padding:"40px 20px",color:"#3a5060",fontSize:"11px",lineHeight:"2"}}>
              Belum ada posisi yang ditutup.
            </div>
          ) : closedPos.map(pos => {
            const isWin = pos.result === "WIN";
            const isBe  = pos.result === "BE";
            return (
              <div key={pos.id} style={{background:isWin?"rgba(0,255,136,0.04)":isBe?"rgba(255,180,0,0.04)":"rgba(255,80,80,0.04)",border:`1px solid ${isWin?"rgba(0,255,136,0.2)":isBe?"rgba(255,180,0,0.2)":"rgba(255,80,80,0.15)"}`,borderRadius:"9px",padding:"10px 12px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"13px",color:"#fff"}}>{pos.coin}</span>
                    <span style={{fontSize:"10px",fontWeight:"700",color:pos.direction==="LONG"?"#00ff88":"#ff5050"}}>{pos.direction==="LONG"?"▲":"▼"} {pos.direction}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"12px",color:isWin?"#00ff88":isBe?"#ffb400":"#ff5050"}}>{isWin?"✅ WIN":isBe?"⚖️ BE":"❌ LOSS"}</span>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"12px",color:isWin?"#00ff88":isBe?"#ffb400":"#ff5050"}}>{(pos.pnlPct||0)>=0?"+":""}{pos.pnlPct}%</span>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"4px"}}>
                  {[["Entry",`$${pos.entryPrice}`],["Close",`$${pos.closePrice}`],["PnL $",`${(pos.pnlUsd||0)>=0?"+":""}$${pos.pnlUsd}`],["By",pos.closedBy||"MANUAL"]].map(([l,v])=>(
                    <div key={l} style={{fontSize:"9px",color:"#5a7080"}}>
                      <span style={{color:"#3a5060"}}>{l}: </span>{v}
                    </div>
                  ))}
                </div>
                {pos.indicators && <div style={{marginTop:"5px",fontSize:"9px",color:"#3a5060",lineHeight:"1.5"}}>
                  MA: {pos.indicators.maPosition||"?"} | VMC: {pos.indicators.vmcDot||"?"} | MF: {pos.indicators.moneyFlow||"?"} | Zone: {pos.indicators.inZone?"IN":"OUT"}
                </div>}
              </div>
            );
          })}
        </div>
      )}

      {/* AI INSIGHT */}
      {demoTab==="insight" && (
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px"}}>
          <button onClick={runLearn} disabled={learnLoading||closedPos.length<3}
            style={{width:"100%",background:"linear-gradient(135deg,#a080ff,#6040cc)",border:"none",borderRadius:"10px",padding:"12px",fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"12px",color:"#fff",cursor:learnLoading||closedPos.length<3?"not-allowed":"pointer",opacity:closedPos.length<3?0.5:1,marginBottom:"14px",transition:"all 0.2s"}}>
            {learnLoading?"🧠 AI Sedang Belajar…":`🧠 Analisis ${closedPos.length} Posisi — Temukan Pattern`}
          </button>

          {closedPos.length<3 && (
            <div style={{textAlign:"center",padding:"20px",fontSize:"11px",color:"#3a5060",lineHeight:"1.8"}}>
              Butuh minimal <strong style={{color:"#ffb400"}}>3 posisi closed</strong> untuk AI belajar.<br/>
              Sekarang: {closedPos.length} posisi.
            </div>
          )}

          {/* PATTERN CARDS */}
          {patterns.length>0 && (
            <div style={{marginBottom:"14px"}}>
              <div style={{fontSize:"9px",color:"#00ff88",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>📊 Pattern Terdeteksi</div>
              {patterns.slice(0,5).map((p,i)=>(
                <div key={i} style={{background:p.winRate>=60?"rgba(0,255,136,0.05)":p.winRate<=30?"rgba(255,80,80,0.05)":"rgba(255,180,0,0.04)",border:`1px solid ${p.winRate>=60?"rgba(0,255,136,0.2)":p.winRate<=30?"rgba(255,80,80,0.15)":"rgba(255,180,0,0.15)"}`,borderRadius:"8px",padding:"9px 11px",marginBottom:"6px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px"}}>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"11px",color:p.winRate>=60?"#00ff88":p.winRate<=30?"#ff5050":"#ffb400"}}>{p.winRate}% WIN RATE</span>
                    <span style={{fontSize:"9px",color:"#4a6080"}}>{p.count}x trades | avg {p.avgPnl>=0?"+":""}{p.avgPnl}%</span>
                  </div>
                  <div style={{fontSize:"9px",color:"#5a7080",lineHeight:"1.6"}}>
                    {p.direction} | {p.key.split("|").map(k=>k.replace("MA_","").replace("VMC_","VMC:").replace("MF_","MF:").replace("DIR_","").replace("ZONE_","Zone:")).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI INSIGHT RESULT */}
          {aiInsight && (
            <div>
              {aiInsight.insight && (
                <div style={{background:"rgba(120,80,255,0.06)",border:"1px solid rgba(120,80,255,0.2)",borderRadius:"10px",padding:"12px 14px",marginBottom:"10px"}}>
                  <div style={{fontSize:"9px",color:"#a080ff",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"6px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>🧠 AI Insight</div>
                  <div style={{fontSize:"11px",color:"#8899aa",lineHeight:"1.7"}}>{aiInsight.insight}</div>
                </div>
              )}
              {aiInsight.rules && (
                <div style={{background:"rgba(0,255,136,0.04)",border:"1px solid rgba(0,255,136,0.15)",borderRadius:"10px",padding:"12px 14px",marginBottom:"10px"}}>
                  <div style={{fontSize:"9px",color:"#00ff88",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"700"}}>✅ Rules Baru (dari AI)</div>
                  {(Array.isArray(aiInsight.rules)?aiInsight.rules:[aiInsight.rules]).map((r,i)=>(
                    <div key={i} style={{display:"flex",gap:"8px",marginBottom:"6px",fontSize:"11px",color:"#8899aa",lineHeight:"1.5"}}>
                      <span style={{color:"#00ff88",flexShrink:0}}>{i+1}.</span><span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* OPEN POSITION MODAL */}
      {openModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:200,display:"flex",alignItems:"flex-end"}} onClick={e=>{if(e.target===e.currentTarget)setOpenModal(false)}}>
          <div style={{background:"#0d1421",border:"1px solid rgba(0,255,136,0.2)",borderRadius:"16px 16px 0 0",padding:"20px 16px 32px",width:"100%",maxWidth:"600px",margin:"0 auto"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"15px",color:"#fff",marginBottom:"4px"}}>📈 Buka Posisi Demo</div>
            <div style={{fontSize:"10px",color:"#4a6080",marginBottom:"16px"}}>
              {decision?.setup ? `Signal: ${decision.signal} | Entry: $${decision.setup.entry} | SL: $${decision.setup.sl} | TP: $${decision.setup.tp}` : "Isi data posisi manual"}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"14px"}}>
              {[["Coin",<input value={form.coin} onChange={e=>setForm(p=>({...p,coin:e.target.value.toUpperCase()}))} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"7px",padding:"8px 10px",color:"#e2e8f0",fontFamily:"Space Mono,monospace",width:"100%",outline:"none",fontSize:"12px"}}/>],
                ["Size (USD)",<input type="number" value={form.size} onChange={e=>setForm(p=>({...p,size:e.target.value}))} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"7px",padding:"8px 10px",color:"#e2e8f0",fontFamily:"Space Mono,monospace",width:"100%",outline:"none",fontSize:"12px"}}/>]
              ].map(([l,inp])=>(
                <div key={l}>
                  <div style={{fontSize:"8px",color:"#4a6080",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"5px"}}>{l}</div>
                  {inp}
                </div>
              ))}
            </div>

            <div style={{marginBottom:"12px"}}>
              <div style={{fontSize:"8px",color:"#4a6080",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"6px"}}>Direction</div>
              <div style={{display:"flex",gap:"8px"}}>
                {["LONG","SHORT"].map(d=>(
                  <button key={d} onClick={()=>setForm(p=>({...p,direction:d}))}
                    style={{flex:1,padding:"10px",borderRadius:"8px",fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"12px",cursor:"pointer",border:`1px solid ${form.direction===d?(d==="LONG"?"rgba(0,255,136,0.5)":"rgba(255,80,80,0.5)"):"rgba(255,255,255,0.08)"}`,background:form.direction===d?(d==="LONG"?"rgba(0,255,136,0.12)":"rgba(255,80,80,0.12)"):"rgba(255,255,255,0.03)",color:form.direction===d?(d==="LONG"?"#00ff88":"#ff5050"):"#5a7080",transition:"all 0.2s"}}>
                    {d==="LONG"?"▲ LONG":"▼ SHORT"}
                  </button>
                ))}
              </div>
            </div>

            {decision?.setup && (
              <div style={{background:"rgba(0,196,255,0.06)",border:"1px solid rgba(0,196,255,0.2)",borderRadius:"8px",padding:"10px 12px",marginBottom:"12px",fontSize:"10px",color:"#8899aa",lineHeight:"1.8"}}>
                <span style={{color:"#00c4ff",fontWeight:"700"}}>Auto dari signal: </span>
                Entry ${ decision.setup.entry} · SL ${decision.setup.sl} · TP ${decision.setup.tp} · RR 1:3
              </div>
            )}

            <div style={{marginBottom:"14px"}}>
              <div style={{fontSize:"8px",color:"#4a6080",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"5px"}}>Catatan (opsional)</div>
              <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2}
                placeholder="contoh: entry sesuai signal 3-layer, konfluensi kuat"
                style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"7px",padding:"8px 10px",color:"#e2e8f0",fontFamily:"Space Mono,monospace",width:"100%",outline:"none",fontSize:"11px",resize:"none"}}/>
            </div>

            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={()=>setOpenModal(false)} style={{flex:1,padding:"11px",borderRadius:"8px",border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)",color:"#6a8099",fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"12px",cursor:"pointer"}}>Batal</button>
              <button onClick={openPosition} style={{flex:2,padding:"11px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#00ff88,#00c4ff)",color:"#080c14",fontFamily:"'Syne',sans-serif",fontWeight:"800",fontSize:"12px",cursor:"pointer"}}>
                📈 Buka Posisi Demo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────
export default function App() {
  const [coinInput, setCoinInput] = useState("");
  const [activeCoin, setActiveCoin] = useState(null);
  const [d4, setD4] = useState(null);
  const [d1, setD1] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState("");
  const [manual, setManual] = useState("");
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoad, setChatLoad] = useState(false);
  const [activeTab, setActiveTab] = useState("signal");
  const [aiModel, setAiModel] = useState("deepseek");
  const [activeMainTab, setActiveMainTab] = useState("trading"); // "trading" | "screener" | "demo"
  const endRef = useRef(null);

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[chatMsgs, chatLoad]);

  async function fetchAndDecide(coin) {
    const sym = coin.toUpperCase().replace(/USDT$/,"");
    setFetching(true); setD4(null); setD1(null);
    try {
      setFetchStatus(`Fetching ${sym}USDT dari BingX Futures…`);
      const [r4, r1] = await Promise.all([
        fetch(`${BACKEND_URL}/api/market?symbol=${sym}&timeframe=4h`),
        fetch(`${BACKEND_URL}/api/market?symbol=${sym}&timeframe=1h`),
      ]);
      const [j4, j1] = await Promise.all([r4.json(), r1.json()]);
      if (j4.error) throw new Error(j4.error);
      if (j1.error) throw new Error(j1.error);
      setD4(j4); setD1(j1);
      setFetchStatus("");
      setActiveTab("signal");
    } catch(e) {
      setFetchStatus("");
      alert(`Error: ${e.message}`);
    } finally { setFetching(false); }
  }

  function handleAnalyze() {
    const coin = coinInput.trim() || activeCoin;
    if (!coin || fetching) return;
    setActiveCoin(coin.toUpperCase());
    fetchAndDecide(coin);
  }

  async function handleChat() {
    const text = manual.trim();
    if (!text || chatLoad) return;
    const ctx = decision ? [
      `Pair: ${decision.pair} | Harga: $${decision.price}`,
      `Keputusan: ${decision.signal} | Confidence: ${decision.confidence}%`,
      decision.setup ? `Entry: $${decision.setup.entry} | SL: $${decision.setup.sl} | TP: $${decision.setup.tp}` : "",
      `Trend 4H: ${decision.layer1?.trend4h?"BULLISH":"BEARISH"} | Zone Long: ${decision.layer2?.inLongZone} | Zone Short: ${decision.layer2?.inShortZone}`,
      `S&R: R=${decision.sr?.nearestResistance||"—"} | S=${decision.sr?.nearestSupport||"—"}`,
      [...(decision.reasons||[]),...(decision.waitReasons||[])].join(" | "),
    ].filter(Boolean).join("\n") : "";
    setChatMsgs(prev=>[...prev,{role:"user",content:text}]);
    setManual("");
    const nh = [...chatHistory, {role:"user", content:text}];
    setChatHistory(nh);
    setChatLoad(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nh, context: ctx, model: aiModel }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const at = data.text || "Tidak ada respons";
      setChatHistory([...nh, {role:"assistant", content:at}]);
      setChatMsgs(prev=>[...prev,{role:"assistant",content:at}]);
    } catch(e) {
      setChatMsgs(prev=>[...prev,{role:"assistant",content:`❌ ${e.message}`}]);
    } finally { setChatLoad(false); }
  }

  const decision = makeDecision(d4, d1);

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* HEADER */}
        <div className="hdr">
          <div className="logo">AI</div>
          <div className="hdr-t">
            <h1>TRADING AGENT — MA × VMC × S{"&"}R</h1>
            <p>BINGX FUTURES LIVE · 3-LAYER DECISION · RR 1:3</p>
          </div>
          <div className="hdr-r">
            <span className="bdg bdg-p">S{"&"}R</span>
            <span className="bdg bdg-g">RR 1:3</span>
            <span className="live-i"><span className="dot-l"/>LIVE</span>
          </div>
        </div>

        {/* MAIN TAB SWITCHER */}
        <div style={{display:"flex",background:"rgba(0,0,0,0.4)",borderBottom:"2px solid rgba(0,255,136,0.15)"}}>
          {[["trading","📊 Trading Agent"],["screener","🔍 Screener"],["demo","🎮 Demo Trading"]].map(([k,v])=>(
            <button key={k}
              style={{flex:1,padding:"11px 4px",fontSize:"10px",fontFamily:"'Syne',sans-serif",fontWeight:"800",
                letterSpacing:"0.06em",textAlign:"center",cursor:"pointer",border:"none",
                background:activeMainTab===k?"rgba(0,255,136,0.08)":"none",
                color:activeMainTab===k?"#00ff88":"#3a5060",
                borderBottom:activeMainTab===k?"2px solid #00ff88":"2px solid transparent",
                transition:"all 0.2s",textTransform:"uppercase",marginBottom:"-2px"}}
              onClick={()=>setActiveMainTab(k)}>{v}</button>
          ))}
        </div>

        {/* ── FIX 1: MULTI-TAB CONTROLLER MENGGUNAKAN DISPLAY NONE (ANTI-RESET STATE BACKGROUND RUNNING) ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          
          {/* TAB A: LOGIKA TRADING AGENT */}
          <div style={{ display: activeMainTab === "trading" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
            {/* COIN INPUT */}
            <div className="coin-sec">
              <div className="sec-lbl">Masukkan nama coin → keputusan otomatis</div>
              <div className="coin-row">
                <input className="coin-inp" placeholder="BTC, ETH, SOL…" value={coinInput}
                  onChange={e=>setCoinInput(e.target.value.toUpperCase())}
                  onKeyDown={e=>e.key==="Enter"&&handleAnalyze()}/>
                <button className="ana-btn" onClick={handleAnalyze} disabled={(!coinInput.trim()&&!activeCoin)||fetching}>
                  {fetching?"Fetching…":"🔍 Analisis"}
                </button>
              </div>
              {fetching && <div className="fetch-s"><div className="spin"/>{fetchStatus}</div>}
              <div className="sec-lbl" style={{marginBottom:"6px"}}>Populer</div>
              <div className="pop-c">
                {POPULAR.map(c=>(
                  <button key={c} className={`c-chip${activeCoin===c?" active":""}`}
                    onClick={()=>{setActiveCoin(c);setCoinInput(c);}}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* INTERNAL TABS */}
            {(d4||decision) && (
              <div style={{display:"flex",borderBottom:"1px solid rgba(0,255,136,0.1)",background:"rgba(0,0,0,0.3)"}}>
                {[["signal","🎯 Keputusan"],["data","📊 Data"],["chat","💬 Tanya AI"]].map(([k,v])=>(
                  <button key={k} style={{flex:1,padding:"9px 4px",fontSize:"9px",fontFamily:"'Syne',sans-serif",
                    fontWeight:"700",letterSpacing:"0.05em",textAlign:"center",cursor:"pointer",
                    color:activeTab===k?"#00ff88":"#3a5060",border:"none",background:"none",
                    borderBottom:activeTab===k?"2px solid #00ff88":"none",
                    transition:"all 0.2s",textTransform:"uppercase"}}
                    onClick={()=>setActiveTab(k)}>{v}</button>
                ))}
              </div>
            )}

            {/* INTERNAL TRADING AGENT CONTENT VIEW */}
            <div style={{flex:1,overflowY:"auto",paddingBottom:"16px"}}>
              {activeTab==="signal" && (
                <div style={{flex:1,overflowY:"auto",paddingBottom:"16px"}}>
                  {!decision && !fetching && (
                    <div style={{padding:"20px 14px"}}>
                      <div className="welcome">
                        <h2>Trading Agent <span>v6</span></h2>
                        <p>Ketik nama coin → agent fetch data BingX Futures → evaluasi 3-layer → keluarkan <strong style={{color:"#00ff88"}}>KEPUTUSAN FINAL</strong> langsung tanpa perlu input manual.</p>
                        <div className="flow">
                          {[["1","Fetch data BingX Futures (4H + 1H)"],["2","Layer 1: Cek trend MA13/21 + VuManChu"],["3","Layer 2: Cek posisi vs Support & Resistance"],["4","Layer 3: Hitung SL & TP (RR 1:3)"],["5","Output: LONG / SHORT / WAIT + alasan"]].map(([n,t])=>(
                            <div key={n} className="flow-item"><div className="flow-n">{n}</div><span>{t}</span></div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {decision && <DecisionCard dec={decision}/>}
                </div>
              )}

              {activeTab==="data" && (
                <div style={{flex:1,overflowY:"auto",paddingBottom:"16px"}}>
                  <LiveCard d4={d4} d1={d1}/>
                </div>
              )}

              {activeTab==="chat" && (
                <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                  {/* MODEL SELECTOR */}
                  <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.05)",background:"rgba(0,0,0,0.25)"}}>
                    <div style={{fontSize:"8px",color:"#3a5060",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"7px"}}>Pilih AI Assistant</div>
                    <div style={{display:"flex",gap:"8px"}}>
                      {[
                        { id:"deepseek", label:"DeepSeek V3", icon:"🧠", desc:"Analisis teknikal · Rules-based", color:"#00c4ff" },
                        { id:"hermes",   label:"Hermes 3",    icon:"🔮", desc:"Natural trader instinct · OpenRouter", color:"#a080ff" },
                      ].map(m=>(
                        <button key={m.id} onClick={()=>{setAiModel(m.id);setChatMsgs([]);setChatHistory([]);}}
                          style={{
                            flex:1, padding:"9px 10px", borderRadius:"9px", cursor:"pointer",
                            border:`1px solid ${aiModel===m.id ? m.color : "rgba(255,255,255,0.08)"}`,
                            background: aiModel===m.id ? `rgba(${m.color==="#00c4ff"?"0,196,255":"120,80,255"},0.1)` : "rgba(255,255,255,0.03)",
                            transition:"all 0.2s", textAlign:"left",
                          }}>
                          <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
                            <span style={{fontSize:"13px"}}>{m.icon}</span>
                            <span style={{fontFamily:"'Syne',sans-serif",fontWeight:"700",fontSize:"10px",color: aiModel===m.id ? m.color : "#6a8099"}}>
                              {m.label}
                            </span>
                            {aiModel===m.id && <span style={{marginLeft:"auto",width:"6px",height:"6px",borderRadius:"50%",background:m.color,flexShrink:0}}/>}
                          </div>
                          <div style={{fontSize:"9px",color:"#3a5060",lineHeight:"1.4"}}>{m.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="msgs">
                    {chatMsgs.length===0 && (
                      <div style={{padding:"16px 0",fontSize:"11px",color:"#3a5060",lineHeight:"1.9",textAlign:"center"}}>
                        <div style={{fontSize:"20px",marginBottom:"8px"}}>{aiModel==="deepseek"?"🧠":"⚡"}</div>
                        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:"700",color: aiModel==="deepseek"?"#00c4ff":"#a080ff",marginBottom:"6px"}}>
                          {aiModel==="deepseek"?"DeepSeek V3 — Technical Analyst":"Hermes 3 — Experienced Trader"} siap menjawab
                        </div>
                        {aiModel==="deepseek"
                          ? <span>Contoh: "Kenapa WAIT?", "Kapan bisa entry?",<br/>"Jelaskan kondisi VMC"</span>
                          : <span>Tanya perspektif natural:<br/>"Gimana kondisi market ini?", "Layak entry gak?",<br/>"Apa yang kamu lihat dari chart ini?"</span>
                        }
                      </div>
                    )}
                    {chatMsgs.map((m,i)=>(
                      <div key={i} className={`msg ${m.role}`}>
                        <div className={`av ${m.role==="assistant"?"av-a":"av-u"}`} style={m.role==="assistant"?{background: aiModel==="deepseek"?"linear-gradient(135deg,#00c4ff,#0088ff)":"linear-gradient(135deg,#a080ff,#6040cc)"}:{}}>
                          {m.role==="user"?"TM": aiModel==="deepseek"?"DS":"H3"}
                        </div>
                        <div className="mc">
                          <div className="bbl">{m.content}</div>
                          {m.role==="assistant" && (
                            <div style={{fontSize:"8px",color:"#2a4050",marginTop:"4px",letterSpacing:"0.05em"}}>
                              {aiModel==="deepseek"?"🧠 DeepSeek V3":"🔮 Hermes 3"}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {chatLoad && (
                      <div className="ldm msg">
                        <div className="av av-a" style={{background: aiModel==="deepseek"?"linear-gradient(135deg,#00c4ff,#0088ff)":"linear-gradient(135deg,#a080ff,#6040cc)"}}>
                          {aiModel==="deepseek"?"DS":"NH"}
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                          <div className="ldd"><div className="ld"/><div className="ld"/><div className="ld"/></div>
                          <div style={{fontSize:"9px",color:"#2a4050"}}>{aiModel==="deepseek"?"DeepSeek menganalisis rules…":"Hermes membaca market…"}</div>
                        </div>
                      </div>
                    )}
                    <div ref={endRef}/>
                  </div>

                  <div className="inp-a">
                    <div className="inp-r">
                      <div className="iw" style={{borderColor: aiModel==="deepseek"?"rgba(0,196,255,0.15)":"rgba(160,128,255,0.15)"}}>
                        <textarea className="ti" placeholder={`Tanya ${aiModel==="deepseek"?"DeepSeek":"Hermes"} tentang analisis ini…`} value={manual}
                          onChange={e=>setManual(e.target.value)}
                          onKeyDown={e=>{if(e.key===\x22Enter\x22&&!e.shiftKey){e.preventDefault();handleChat();}}} rows={1}/>
                      </div>
                      <button className="sb" onClick={handleChat} disabled={!manual.trim()||chatLoad}
                        style={{background: aiModel==="deepseek"?"linear-gradient(135deg,#00c4ff,#0088ff)":"linear-gradient(135deg,#a080ff,#6040cc)"}}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap=\"round\" strokeLinejoin=\"round\"><line x1=\"22\" y1=\"2\" x2=\"11\" y2=\"13\"/><polygon points=\"22 2 15 22 11 13 2 9 22 2\"/></svg>
                      </button>
                    </div>
                    <div className="hint">Pilih model di atas · ganti model = chat history reset · ENTER untuk kirim</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* TAB B: LOGIKA SCREENER (ANTI-RESET) */}
          <div style={{ display: activeMainTab === "screener" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
            <ScreenerTab />
          </div>

          {/* TAB C: LOGIKA DEMO TRADING (ANTI-RESET) */}
          <div style={{ display: activeMainTab === "demo" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
            <DemoTrading decision={decision} d4={d4}/>
          </div>

        </div>
      </div>
    </>
  );
}
