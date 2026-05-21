// api/demo.js — Demo Trading Engine
// Endpoints:
//   POST /api/demo?action=open     → buka posisi demo
//   POST /api/demo?action=close    → tutup posisi demo
//   GET  /api/demo?action=list     → ambil semua posisi
//   GET  /api/demo?action=price    → harga realtime BingX
//   POST /api/demo?action=learn    → AI analisis pattern dari database
//   GET  /api/demo?action=patterns → ambil pattern yang sudah dipelajari

// Storage menggunakan Vercel KV atau in-memory (untuk demo)
// Untuk production: tambahkan Vercel KV atau PlanetScale

const CORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

// In-memory storage (reset on cold start)
// Untuk persistent: ganti dengan Vercel KV
let DB = { positions: [], patterns: [], stats: { wins:0, losses:0, totalPnl:0, winRate:0 } };

async function getBingXPrice(symbol) {
  try {
    const pair = symbol.toUpperCase().replace(/USDT$/,"") + "-USDT";
    const r = await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker/price?symbol=${pair}`);
    const d = await r.json();
    return parseFloat(d.data?.price || d.price || 0);
  } catch { return 0; }
}

function calcPnl(pos, currentPrice) {
  const entry = parseFloat(pos.entryPrice);
  const size  = parseFloat(pos.size);       // dalam USD
  const price = parseFloat(currentPrice);
  if (!entry || !price) return { pnl: 0, pnlPct: 0, pnlUsd: 0 };

  const pnlPct = pos.direction === "LONG"
    ? ((price - entry) / entry) * 100
    : ((entry - price) / entry) * 100;

  const pnlUsd = (pnlPct / 100) * size;
  return {
    pnl:    parseFloat(pnlPct.toFixed(4)),
    pnlPct: parseFloat(pnlPct.toFixed(4)),
    pnlUsd: parseFloat(pnlUsd.toFixed(2)),
  };
}

function updateStats() {
  const closed = DB.positions.filter(p => p.status === "closed");
  const wins   = closed.filter(p => p.result === "WIN");
  const losses = closed.filter(p => p.result === "LOSS");
  DB.stats = {
    total:    closed.length,
    wins:     wins.length,
    losses:   losses.length,
    be:       closed.filter(p => p.result === "BE").length,
    open:     DB.positions.filter(p => p.status === "open").length,
    winRate:  closed.length > 0 ? parseFloat((wins.length / closed.length * 100).toFixed(1)) : 0,
    totalPnl: parseFloat(closed.reduce((a, p) => a + (p.pnlUsd || 0), 0).toFixed(2)),
    avgWin:   wins.length > 0 ? parseFloat((wins.reduce((a,p)=>a+(p.pnlPct||0),0)/wins.length).toFixed(2)) : 0,
    avgLoss:  losses.length > 0 ? parseFloat((losses.reduce((a,p)=>a+(p.pnlPct||0),0)/losses.length).toFixed(2)) : 0,
  };
}

function extractPatterns() {
  const closed = DB.positions.filter(p => p.status === "closed" && p.indicators);
  if (closed.length < 2) return [];

  const patterns = {};

  closed.forEach(pos => {
    const ind = pos.indicators || {};
    // Key pattern: kombinasi kondisi indikator
    const key = [
      `MA_${ind.maPosition || "?"}`,
      `VMC_${ind.vmcDot || "NONE"}`,
      `MF_${ind.moneyFlow > 0 ? "POS" : "NEG"}`,
      `DIR_${pos.direction}`,
      `ZONE_${ind.inZone ? "IN" : "OUT"}`,
    ].join("|");

    if (!patterns[key]) {
      patterns[key] = { key, count:0, wins:0, losses:0, totalPnl:0, conditions: ind, direction: pos.direction, examples:[] };
    }
    patterns[key].count++;
    if (pos.result === "WIN") patterns[key].wins++;
    if (pos.result === "LOSS") patterns[key].losses++;
    patterns[key].totalPnl += pos.pnlPct || 0;
    if (patterns[key].examples.length < 3) {
      patterns[key].examples.push({ coin: pos.coin, pnlPct: pos.pnlPct, date: pos.openTime });
    }
  });

  return Object.values(patterns)
    .map(p => ({
      ...p,
      winRate: p.count > 0 ? parseFloat((p.wins / p.count * 100).toFixed(1)) : 0,
      avgPnl:  p.count > 0 ? parseFloat((p.totalPnl / p.count).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.count - a.count);
}

export default async function handler(req, res) {
  CORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;

  // ── GET REALTIME PRICE ────────────────────────────────────────
  if (action === "price") {
    const { symbol = "BTC" } = req.query;
    const price = await getBingXPrice(symbol);
    // Update PnL semua open positions
    DB.positions.filter(p => p.status === "open" && p.coin === symbol.toUpperCase()).forEach(pos => {
      const { pnl, pnlPct, pnlUsd } = calcPnl(pos, price);
      pos.currentPrice = price;
      pos.pnl    = pnl;
      pos.pnlPct = pnlPct;
      pos.pnlUsd = pnlUsd;
      // Auto SL/TP check
      if (pos.slPrice && ((pos.direction==="LONG" && price <= pos.slPrice) || (pos.direction==="SHORT" && price >= pos.slPrice))) {
        pos.status = "closed"; pos.result = "LOSS"; pos.closePrice = price;
        pos.closeTime = new Date().toISOString(); pos.closedBy = "SL_HIT";
        updateStats();
      }
      if (pos.tpPrice && ((pos.direction==="LONG" && price >= pos.tpPrice) || (pos.direction==="SHORT" && price <= pos.tpPrice))) {
        pos.status = "closed"; pos.result = "WIN"; pos.closePrice = price;
        pos.closeTime = new Date().toISOString(); pos.closedBy = "TP_HIT";
        updateStats();
      }
    });
    return res.status(200).json({ price, symbol: symbol.toUpperCase() });
  }

  // ── LIST POSITIONS ────────────────────────────────────────────
  if (action === "list") {
    return res.status(200).json({ positions: DB.positions, stats: DB.stats, patterns: DB.patterns });
  }

  // ── GET PATTERNS ──────────────────────────────────────────────
  if (action === "patterns") {
    const patterns = extractPatterns();
    DB.patterns = patterns;
    return res.status(200).json({ patterns, stats: DB.stats });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

  const body = req.body || {};

  // ── OPEN POSITION ─────────────────────────────────────────────
  if (action === "open") {
    const { coin, direction, size, entryPrice, slPrice, tpPrice, indicators, signalConfidence } = body;
    if (!coin || !direction || !entryPrice) return res.status(400).json({ error: "coin, direction, entryPrice required" });

    const pos = {
      id:          Date.now().toString(),
      coin:        coin.toUpperCase(),
      direction:   direction.toUpperCase(), // LONG | SHORT
      status:      "open",
      size:        parseFloat(size) || 100,
      entryPrice:  parseFloat(entryPrice),
      currentPrice: parseFloat(entryPrice),
      slPrice:     slPrice ? parseFloat(slPrice) : null,
      tpPrice:     tpPrice ? parseFloat(tpPrice) : null,
      pnl:         0, pnlPct: 0, pnlUsd: 0,
      openTime:    new Date().toISOString(),
      closeTime:   null, closePrice: null,
      result:      null, closedBy: null,
      indicators:  indicators || {},       // kondisi MA, VMC, S&R saat open
      signalConfidence: signalConfidence || 0,
      notes:       body.notes || "",
    };

    DB.positions.unshift(pos);
    updateStats();
    return res.status(200).json({ success: true, position: pos, message: `Posisi ${direction} ${coin} dibuka @ $${entryPrice}` });
  }

  // ── CLOSE POSITION ────────────────────────────────────────────
  if (action === "close") {
    const { id, closePrice, closedBy = "MANUAL" } = body;
    if (!id || !closePrice) return res.status(400).json({ error: "id dan closePrice required" });

    const pos = DB.positions.find(p => p.id === id);
    if (!pos) return res.status(404).json({ error: "Position not found" });
    if (pos.status === "closed") return res.status(400).json({ error: "Already closed" });

    const { pnl, pnlPct, pnlUsd } = calcPnl(pos, closePrice);
    pos.status     = "closed";
    pos.closePrice = parseFloat(closePrice);
    pos.closeTime  = new Date().toISOString();
    pos.pnl        = pnl;
    pos.pnlPct     = pnlPct;
    pos.pnlUsd     = pnlUsd;
    pos.closedBy   = closedBy;

    // Tentukan result
    if (pnlPct > 0.1)       pos.result = "WIN";
    else if (pnlPct < -0.1) pos.result = "LOSS";
    else                     pos.result = "BE";

    updateStats();

    // Extract patterns setelah setiap close
    DB.patterns = extractPatterns();

    return res.status(200).json({
      success:  true,
      position: pos,
      stats:    DB.stats,
      patterns: DB.patterns,
      message:  `Posisi ditutup: ${pos.result} | PnL: ${pnlPct > 0 ? "+" : ""}${pnlPct}% ($${pnlUsd})`,
    });
  }

  // ── AI LEARN — analisis pattern dan buat insight ───────────────
  if (action === "learn") {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "No AI API key configured" });

    const closed = DB.positions.filter(p => p.status === "closed");
    if (closed.length < 3) return res.status(200).json({ insight: "Butuh minimal 3 posisi closed untuk analisis pattern.", patterns: [] });

    const patterns = extractPatterns();
    const summary = closed.slice(-20).map(p =>
      `${p.direction} ${p.coin} | Entry:$${p.entryPrice} | Close:$${p.closePrice} | ${p.result} ${p.pnlPct>0?"+":""}${p.pnlPct}% | MA:${p.indicators?.maPosition||"?"} VMC:${p.indicators?.vmcDot||"?"} MF:${p.indicators?.moneyFlow||"?"} Zone:${p.indicators?.inZone?"IN":"OUT"}`
    ).join("\n");

    const prompt = `Analisis ${closed.length} posisi trading demo berikut dan temukan pattern KEMENANGAN dan KEGAGALAN:

DATA POSISI:
${summary}

STATISTIK:
- Win Rate: ${DB.stats.winRate}%
- Total: ${DB.stats.wins} WIN, ${DB.stats.losses} LOSS
- Avg Win: +${DB.stats.avgWin}% | Avg Loss: ${DB.stats.avgLoss}%

TUGAS:
1. Identifikasi kondisi indikator yang paling sering menghasilkan WIN
2. Identifikasi kondisi yang paling sering menghasilkan LOSS
3. Berikan 3 aturan spesifik untuk meningkatkan win rate
4. Format: JSON dengan field "winPatterns", "lossPatterns", "rules", "insight"`;

    try {
      let aiText = "";
      if (process.env.DEEPSEEK_API_KEY) {
        const r = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({ model: "deepseek-chat", max_tokens: 1000, temperature: 0.2,
            messages: [{ role: "user", content: prompt }] }),
        });
        const d = await r.json();
        aiText = d.choices?.[0]?.message?.content || "";
      } else {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 1000, temperature: 0.2,
            messages: [{ role: "user", content: prompt }] }),
        });
        const d = await r.json();
        aiText = d.choices?.[0]?.message?.content || "";
      }

      // Parse JSON dari response AI
      let aiInsight = null;
      try {
        const m = aiText.replace(/```json|```/g,"").trim().match(/\{[\s\S]*\}/);
        if (m) aiInsight = JSON.parse(m[0]);
      } catch {}

      DB.patterns = patterns;
      return res.status(200).json({ success: true, insight: aiInsight, rawText: aiText, patterns, stats: DB.stats });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
}
