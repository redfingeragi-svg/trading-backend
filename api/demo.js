// api/demo.js — Demo Trading Engine + Supabase persistent storage
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, DEEPSEEK_API_KEY / OPENROUTER_API_KEY

const CORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

// ── SUPABASE CLIENT (lightweight, no SDK needed) ──────────────────
function supabase(table) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const base = `${url}/rest/v1/${table}`;
  const headers = {
    "Content-Type": "application/json",
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Prefer": "return=representation",
  };

  return {
    async select(query = "*", filters = "") {
      const r = await fetch(`${base}?select=${query}${filters}`, { headers });
      return r.json();
    },
    async insert(data) {
      const r = await fetch(base, { method:"POST", headers, body: JSON.stringify(data) });
      return r.json();
    },
    async update(data, filter) {
      const r = await fetch(`${base}?${filter}`, {
        method: "PATCH", headers: {...headers, "Prefer":"return=representation"}, body: JSON.stringify(data)
      });
      return r.json();
    },
    async delete(filter) {
      const r = await fetch(`${base}?${filter}`, { method:"DELETE", headers });
      return r.json();
    },
    async upsert(data) {
      const r = await fetch(base, {
        method:"POST", headers:{...headers,"Prefer":"resolution=merge-duplicates,return=representation"}, body: JSON.stringify(data)
      });
      return r.json();
    },
  };
}

// ── HELPERS ───────────────────────────────────────────────────────
async function getBingXPrice(symbol) {
  try {
    const pair = symbol.toUpperCase().replace(/USDT$/, "") + "-USDT";
    const r = await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker/price?symbol=${pair}`);
    const d = await r.json();
    return parseFloat(d.data?.price || 0);
  } catch { return 0; }
}

function calcPnl(direction, entryPrice, currentPrice, size) {
  const pnlPct = direction === "LONG"
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;
  return {
    pnlPct: parseFloat(pnlPct.toFixed(4)),
    pnlUsd: parseFloat(((pnlPct / 100) * size).toFixed(2)),
  };
}

async function recalcStats() {
  const db = supabase("positions");
  const all = await db.select("result,pnl_pct,pnl_usd,status");
  const closed = all.filter(p => p.status === "closed");
  const wins   = closed.filter(p => p.result === "WIN");
  const losses = closed.filter(p => p.result === "LOSS");

  const stats = {
    id:        1,
    total:     closed.length,
    wins:      wins.length,
    losses:    losses.length,
    be_count:  closed.filter(p => p.result === "BE").length,
    open_count: all.filter(p => p.status === "open").length,
    win_rate:  closed.length > 0 ? parseFloat((wins.length / closed.length * 100).toFixed(1)) : 0,
    total_pnl: parseFloat(closed.reduce((a, p) => a + (p.pnl_usd || 0), 0).toFixed(2)),
    avg_win:   wins.length > 0   ? parseFloat((wins.reduce((a,p)=>a+(p.pnl_pct||0),0)/wins.length).toFixed(2))   : 0,
    avg_loss:  losses.length > 0 ? parseFloat((losses.reduce((a,p)=>a+(p.pnl_pct||0),0)/losses.length).toFixed(2)) : 0,
    updated_at: new Date().toISOString(),
  };
  await supabase("stats").upsert(stats);
  return stats;
}

async function extractAndSavePatterns() {
  const positions = await supabase("positions").select(
    "direction,result,pnl_pct,coin,ma_position,vmc_dot,money_flow,in_zone,open_time",
    "&status=eq.closed"
  );

  const patternMap = {};
  positions.forEach(pos => {
    const key = [
      `MA_${pos.ma_position?.includes("ATAS") ? "BULL" : "BEAR"}`,
      `VMC_${pos.vmc_dot || "NONE"}`,
      `MF_${(pos.money_flow || 0) > 0 ? "POS" : "NEG"}`,
      `DIR_${pos.direction}`,
      `ZONE_${pos.in_zone ? "IN" : "OUT"}`,
    ].join("|");

    if (!patternMap[key]) patternMap[key] = { key, direction:pos.direction, count:0, wins:0, losses:0, totalPnl:0, examples:[], conditions:{ma_position:pos.ma_position,vmc_dot:pos.vmc_dot,money_flow:pos.money_flow,in_zone:pos.in_zone} };
    patternMap[key].count++;
    if (pos.result === "WIN") patternMap[key].wins++;
    if (pos.result === "LOSS") patternMap[key].losses++;
    patternMap[key].totalPnl += pos.pnl_pct || 0;
    if (patternMap[key].examples.length < 3) patternMap[key].examples.push({coin:pos.coin,pnlPct:pos.pnl_pct,date:pos.open_time});
  });

  const patterns = Object.values(patternMap).map(p => ({
    pattern_key:  p.key,
    direction:    p.direction,
    win_rate:     p.count > 0 ? parseFloat((p.wins/p.count*100).toFixed(1)) : 0,
    avg_pnl:      p.count > 0 ? parseFloat((p.totalPnl/p.count).toFixed(2)) : 0,
    trade_count:  p.count,
    win_count:    p.wins,
    loss_count:   p.losses,
    conditions:   p.conditions,
    examples:     p.examples,
    updated_at:   new Date().toISOString(),
  }));

  // Clear old patterns dan insert baru
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/patterns`, {
    method: "DELETE",
    headers: { "apikey":process.env.SUPABASE_SERVICE_KEY, "Authorization":`Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type":"application/json" },
  });
  if (patterns.length > 0) await supabase("patterns").insert(patterns);
  return patterns.sort((a,b) => b.win_rate - a.win_rate || b.trade_count - a.trade_count);
}

// ── MAIN HANDLER ──────────────────────────────────────────────────
export default async function handler(req, res) {
  CORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "SUPABASE_URL and SUPABASE_SERVICE_KEY not configured in Vercel env vars" });
  }

  const { action } = req.query;

  // ── GET PRICE ─────────────────────────────────────────────────
  if (action === "price") {
    const { symbol = "BTC" } = req.query;
    const price = await getBingXPrice(symbol);

    // Check open positions for this coin — auto SL/TP
    const openPos = await supabase("positions").select("*", `&status=eq.open&coin=eq.${symbol.toUpperCase()}`);
    for (const pos of openPos) {
      const { pnlPct, pnlUsd } = calcPnl(pos.direction, pos.entry_price, price, pos.size);
      let shouldClose = false, result = null, closedBy = null;

      if (pos.sl_price && ((pos.direction==="LONG" && price<=pos.sl_price)||(pos.direction==="SHORT" && price>=pos.sl_price))) {
        shouldClose = true; result = "LOSS"; closedBy = "SL_HIT";
      }
      if (pos.tp_price && ((pos.direction==="LONG" && price>=pos.tp_price)||(pos.direction==="SHORT" && price<=pos.tp_price))) {
        shouldClose = true; result = "WIN"; closedBy = "TP_HIT";
      }

      if (shouldClose) {
        await supabase("positions").update({
          status:"closed", result, close_price:price, pnl_pct:pnlPct, pnl_usd:pnlUsd,
          closed_by:closedBy, close_time:new Date().toISOString()
        }, `id=eq.${pos.id}`);
        await recalcStats();
      }
    }
    return res.status(200).json({ price, symbol: symbol.toUpperCase() });
  }

  // ── LIST ALL DATA ─────────────────────────────────────────────
  if (action === "list") {
    const [positions, statsArr, patterns] = await Promise.all([
      supabase("positions").select("*", "&order=open_time.desc&limit=100"),
      supabase("stats").select("*", "&id=eq.1"),
      supabase("patterns").select("*", "&order=win_rate.desc&limit=20"),
    ]);

    // 1. Terjemahkan format Positions untuk Frontend
    const formattedPositions = (positions || []).map(p => ({
      ...p,
      entryPrice: p.entry_price,
      closePrice: p.close_price,
      slPrice: p.sl_price,
      tpPrice: p.tp_price,
      pnlPct: p.pnl_pct,
      pnlUsd: p.pnl_usd,
      signalConfidence: p.signal_confidence,
      closedBy: p.closed_by
    }));

    // 2. Terjemahkan format Stats untuk Frontend
    const rawStats = statsArr?.[0] || {};
    const formattedStats = {
      ...rawStats,
      winRate: rawStats.win_rate,
      totalPnl: rawStats.total_pnl,
      open: rawStats.open_count
    };

    // 3. Terjemahkan format Patterns untuk Frontend
    const formattedPatterns = (patterns || []).map(p => ({
      ...p,
      key: p.pattern_key,
      winRate: p.win_rate,
      avgPnl: p.avg_pnl,
      count: p.trade_count
    }));

    return res.status(200).json({
      positions: formattedPositions,
      stats: formattedStats,
      patterns: formattedPatterns,
    });
  }
  // ── GET PATTERNS ──────────────────────────────────────────────
  if (action === "patterns") {
    const patterns = await extractAndSavePatterns();
    const stats = await recalcStats();
    return res.status(200).json({ patterns, stats });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST required for this action" });
  const body = req.body || {};

  // ── OPEN POSITION ─────────────────────────────────────────────
  if (action === "open") {
    const { coin, direction, size, entryPrice, slPrice, tpPrice, indicators, signalConfidence, notes } = body;
    if (!coin || !direction || !entryPrice) return res.status(400).json({ error: "coin, direction, entryPrice required" });

    const pos = {
      id:                 Date.now().toString(),
      coin:               coin.toUpperCase(),
      direction:          direction.toUpperCase(),
      status:             "open",
      size:               parseFloat(size) || 100,
      entry_price:        parseFloat(entryPrice),
      sl_price:           slPrice ? parseFloat(slPrice) : null,
      tp_price:           tpPrice ? parseFloat(tpPrice) : null,
      pnl_pct:            0,
      pnl_usd:            0,
      signal_confidence:  signalConfidence || 0,
      notes:              notes || "",
      ma_position:        indicators?.maPosition || null,
      vmc_dot:            indicators?.vmcDot || "NONE",
      vmc_circle:         indicators?.vmcCircle || "NONE",
      money_flow:         indicators?.moneyFlow || 0,
      in_zone:            indicators?.inZone || false,
      trend_4h:           indicators?.trend4h || false,
      ma_separation:      indicators?.separation || null,
      open_time:          new Date().toISOString(),
    };

    const inserted = await supabase("positions").insert(pos);
    await recalcStats();
    return res.status(200).json({ success:true, position:inserted?.[0]||pos, message:`Posisi ${direction} ${coin} dibuka @ $${entryPrice}` });
  }

  // ── CLOSE POSITION ────────────────────────────────────────────
  if (action === "close") {
    const { id, closePrice, closedBy = "MANUAL" } = body;
    if (!id || !closePrice) return res.status(400).json({ error: "id dan closePrice required" });

    const posArr = await supabase("positions").select("*", `&id=eq.${id}`);
    const pos = posArr?.[0];
    if (!pos) return res.status(404).json({ error: "Position not found" });
    if (pos.status === "closed") return res.status(400).json({ error: "Already closed" });

    const { pnlPct, pnlUsd } = calcPnl(pos.direction, pos.entry_price, parseFloat(closePrice), pos.size);
    const result = pnlPct > 0.1 ? "WIN" : pnlPct < -0.1 ? "LOSS" : "BE";

    await supabase("positions").update({
      status: "closed", close_price: parseFloat(closePrice), pnl_pct: pnlPct,
      pnl_usd: pnlUsd, result, closed_by: closedBy, close_time: new Date().toISOString(),
    }, `id=eq.${id}`);

    const [stats, patterns] = await Promise.all([recalcStats(), extractAndSavePatterns()]);
    return res.status(200).json({
      success:true, stats, patterns,
      message: `${result} | PnL: ${pnlPct>0?"+":""}${pnlPct}% ($${pnlUsd})`,
    });
  }

  // ── AI LEARN ─────────────────────────────────────────────────
  if (action === "learn") {
    const positions = await supabase("positions").select(
      "direction,coin,entry_price,close_price,result,pnl_pct,ma_position,vmc_dot,money_flow,in_zone,open_time",
      "&status=eq.closed&order=open_time.desc&limit=50"
    );
    if (!positions || positions.length < 3) {
      return res.status(200).json({ insight: "Butuh minimal 3 posisi closed untuk analisis.", patterns:[] });
    }

    const statsArr = await supabase("stats").select("*", "&id=eq.1");
    const st = statsArr?.[0] || {};
    const patterns = await extractAndSavePatterns();

    const summary = positions.map(p =>
      `${p.direction} ${p.coin} | Entry:$${p.entry_price} | Close:$${p.close_price} | ${p.result} ${p.pnl_pct>0?"+":""}${p.pnl_pct}% | MA:${p.ma_position||"?"} VMC:${p.vmc_dot||"?"} MF:${p.money_flow||"?"} Zone:${p.in_zone?"IN":"OUT"}`
    ).join("\n");

    const prompt = `Analisis ${positions.length} posisi trading demo dan temukan pattern WIN vs LOSS:

DATA:
${summary}

STATISTIK: Win Rate ${st.win_rate}% | ${st.wins}W/${st.losses}L | Avg Win +${st.avg_win}% | Avg Loss ${st.avg_loss}%

Identifikasi:
1. Kondisi indikator yang paling sering menghasilkan WIN
2. Kondisi yang paling sering menghasilkan LOSS
3. 3 rules konkret untuk meningkatkan win rate

Format JSON: {"winPatterns":["..."],"lossPatterns":["..."],"rules":["..."],"insight":"..."}`;

    let aiText = "";
    try {
      if (process.env.DEEPSEEK_API_KEY) {
        const r = await fetch("https://api.deepseek.com/chat/completions", {
          method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.DEEPSEEK_API_KEY}`},
          body:JSON.stringify({model:"deepseek-chat",max_tokens:1000,temperature:0.2,messages:[{role:"user",content:prompt}]}),
        });
        const d = await r.json();
        aiText = d.choices?.[0]?.message?.content || "";
      } else if (process.env.OPENROUTER_API_KEY) {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENROUTER_API_KEY}`,"HTTP-Referer":"https://trading-fronted-six.vercel.app"},
          body:JSON.stringify({model:"nousresearch/hermes-3-llama-3.1-70b",max_tokens:1000,temperature:0.2,messages:[{role:"user",content:prompt}]}),
        });
        const d = await r.json();
        aiText = d.choices?.[0]?.message?.content || "";
      }
    } catch(e) { aiText = ""; }

    let aiInsight = null;
    try {
      const m = aiText.replace(/```json|```/g,"").trim().match(/\{[\s\S]*\}/);
      if (m) aiInsight = JSON.parse(m[0]);
    } catch {}

    if (aiInsight) {
      await supabase("ai_insights").insert({
        win_patterns:  JSON.stringify(aiInsight.winPatterns || []),
        loss_patterns: JSON.stringify(aiInsight.lossPatterns || []),
        rules:         JSON.stringify(aiInsight.rules || []),
        insight:       aiInsight.insight || "",
        raw_text:      aiText,
        based_on:      positions.length,
        created_at:    new Date().toISOString(),
      });
    }

    return res.status(200).json({ success:true, insight:aiInsight, patterns, stats:st });
  }

  return res.status(400).json({ error: `Invalid action: ${action}` });
}
