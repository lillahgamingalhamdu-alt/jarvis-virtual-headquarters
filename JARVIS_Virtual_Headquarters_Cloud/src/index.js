const MODEL_DEFAULT = "llama-3.3-70b-versatile";
const now = () => new Date().toISOString();
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const numOrNull = v => v === null || v === "" || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

async function log(env, message, kind = "info") {
  await env.DB.prepare("INSERT INTO activity_log(message, kind, created_at) VALUES (?, ?, ?)").bind(message, kind, now()).run();
}
async function alert(env, title, message, severity = "info") {
  await env.DB.prepare("INSERT INTO alerts(title, message, severity, created_at) VALUES (?, ?, ?, ?)").bind(title, message, severity, now()).run();
  await log(env, `${title}: ${message}`, severity);
}
async function getSettings(env) {
  let s = await env.DB.prepare("SELECT * FROM settings WHERE id=1").first();
  if (!s) {
    await env.DB.prepare("INSERT OR IGNORE INTO settings(id, updated_at) VALUES(1, ?)").bind(now()).run();
    s = await env.DB.prepare("SELECT * FROM settings WHERE id=1").first();
  }
  return s;
}

async function marketData(env, settings) {
  const currency = String(settings.currency || "usd").toLowerCase();
  const asset = String(settings.asset || "bitcoin").toLowerCase();

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", asset);
  url.searchParams.set("vs_currencies", currency);
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_24hr_high", "true");
  url.searchParams.set("include_24hr_low", "true");

  const headers = { accept: "application/json" };
  if (env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = env.COINGECKO_API_KEY;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status}: gagal mengambil harga.`);
  }

  const data = await res.json();
  const d = data[asset];
  if (!d || d[currency] == null) {
    throw new Error("Data harga kosong. Periksa asset ID dan mata uang.");
  }

  return {
    id: asset,
    name: asset,
    symbol: asset.toUpperCase(),
    price: d[currency],
    currency: currency.toUpperCase(),
    change24h: d[`${currency}_24h_change`] ?? null,
    change1h: null,
    high24h: d[`${currency}_24h_high`] ?? null,
    low24h: d[`${currency}_24h_low`] ?? null,
    marketCap: null,
    volume24h: null,
    image: null,
    fetchedAt: now()
  };
}

async function analyze(env, market, previous, memories) {
  if (!env.GROQ_API_KEY) throw new Error("Secret GROQ_API_KEY belum diatur di Cloudflare.");
  const model = env.GROQ_MODEL || MODEL_DEFAULT;
  const prompt = {
    role: "You are a careful market-monitoring agent. Analyze only supplied data. Never invent news or claim certainty.",
    rules: ["Use Bahasa Indonesia.", "Separate facts from interpretation.", "Do not give guaranteed predictions.", "Do not execute trades.", "Return valid JSON only."],
    schema: { summary: "brief summary", regime: "bullish|bearish|sideways|uncertain", signals: ["data-grounded signal"], risks: ["risk or limitation"], nextWatch: ["next things to monitor"], confidence: "low|medium|high" },
    currentSnapshot: market,
    previousSnapshot: previous || null,
    recentMemory: memories
  };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 700, messages: [
      { role: "system", content: "You are JARVIS, a bounded market monitoring agent. Return valid JSON only." },
      { role: "user", content: JSON.stringify(prompt) }
    ] })
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0,220)}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return { result: JSON.parse(clean), model }; }
  catch { return { result: { summary: raw.slice(0,1000), regime:"uncertain", signals:[], risks:["AI response format invalid"], nextWatch:[], confidence:"low" }, model }; }
}
async function cycle(env) {
  const s = await getSettings(env);
  if (!s.enabled) return { skipped: true, reason: "monitoring disabled" };
  const previous = await env.DB.prepare("SELECT * FROM snapshots WHERE asset=? ORDER BY id DESC LIMIT 1").bind(s.asset).first();
  const market = await marketData(env, s);
  await env.DB.prepare("INSERT INTO snapshots(asset,price,currency,change_24h,high_24h,low_24h,fetched_at) VALUES(?,?,?,?,?,?,?)")
    .bind(s.asset, market.price, market.currency, market.change24h, market.high24h, market.low24h, market.fetchedAt).run();

  let fired = false;
  if (s.alert_above != null && market.price >= s.alert_above) {
    await alert(env, "Target harga tercapai", `${market.symbol} ${market.price} ${market.currency}, melewati target ${s.alert_above}.`, "warning"); fired = true;
  }
  if (s.alert_below != null && market.price <= s.alert_below) {
    await alert(env, "Batas harga terlewati", `${market.symbol} ${market.price} ${market.currency}, di bawah batas ${s.alert_below}.`, "warning"); fired = true;
  }
  if (previous?.price && Number(s.change_alert_pct) > 0) {
    const change = ((market.price - previous.price) / previous.price) * 100;
    if (Math.abs(change) >= Number(s.change_alert_pct)) {
      await alert(env, "Perubahan harga terdeteksi", `${market.symbol} berubah ${change.toFixed(2)}% sejak snapshot sebelumnya.`, change < 0 ? "warning" : "info"); fired = true;
    }
  }
  let analysis = null;
  if (s.ai_analysis) {
    const memories = await env.DB.prepare("SELECT note, created_at FROM memory ORDER BY id DESC LIMIT 6").all();
    const a = await analyze(env, market, previous, memories.results || []);
    analysis = a.result;
    await env.DB.prepare("INSERT INTO analyses(summary,regime,signals_json,risks_json,next_watch_json,confidence,model,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(analysis.summary || "", analysis.regime || "uncertain", JSON.stringify(analysis.signals || []), JSON.stringify(analysis.risks || []), JSON.stringify(analysis.nextWatch || []), analysis.confidence || "low", a.model, now()).run();
    const note = `${market.symbol} ${market.price} ${market.currency}; change24h=${market.change24h}; regime=${analysis.regime}; ${analysis.summary || ""}`;
    await env.DB.prepare("INSERT INTO memory(note,created_at) VALUES(?,?)").bind(note, now()).run();
    await log(env, `Agent cycle complete. Regime: ${analysis.regime || "uncertain"}.`, "success");
  } else await log(env, "Market snapshot collected; AI analysis disabled.", "success");
  return { ok:true, market, analysis, alertTriggered:fired };
}
async function stateResponse(env) {
  const settings = await getSettings(env);
  const [market, analysis, alerts, memory, logs] = await Promise.all([
    env.DB.prepare("SELECT * FROM snapshots ORDER BY id DESC LIMIT 1").first(),
    env.DB.prepare("SELECT * FROM analyses ORDER BY id DESC LIMIT 1").first(),
    env.DB.prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT 30").all(),
    env.DB.prepare("SELECT * FROM memory ORDER BY id DESC LIMIT 30").all(),
    env.DB.prepare("SELECT * FROM activity_log ORDER BY id DESC LIMIT 30").all()
  ]);
  const parsedAnalysis = analysis ? {
    summary:analysis.summary, regime:analysis.regime, signals:JSON.parse(analysis.signals_json||"[]"),
    risks:JSON.parse(analysis.risks_json||"[]"), nextWatch:JSON.parse(analysis.next_watch_json||"[]"),
    confidence:analysis.confidence, model:analysis.model, at:analysis.created_at
  } : null;
  return {
    settings:{ enabled:!!settings.enabled, asset:settings.asset, currency:settings.currency, intervalMinutes:settings.interval_minutes,
      alertAbove:settings.alert_above, alertBelow:settings.alert_below, changeAlertPct:settings.change_alert_pct, aiAnalysis:!!settings.ai_analysis },
    latestMarket: market ? { id:market.asset, price:market.price, currency:market.currency, change24h:market.change_24h, high24h:market.high_24h, low24h:market.low_24h, fetchedAt:market.fetched_at } : null,
    latestAnalysis:parsedAnalysis,
    alerts:alerts.results || [], memory:memory.results || [], logs:logs.results || [],
    groqConfigured:!!env.GROQ_API_KEY, coingeckoConfigured:!!env.COINGECKO_API_KEY,
    model:env.GROQ_MODEL || MODEL_DEFAULT
  };
}
async function api(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/state") return json(await stateResponse(env));
  if (request.method === "GET" && url.pathname === "/api/health") return json({ ok:true, at:now() });
  if (request.method === "POST" && url.pathname === "/api/settings") {
    const b = await request.json();
    const old = await getSettings(env);
    const asset = typeof b.asset === "string" && /^[a-z0-9-]{2,50}$/i.test(b.asset) ? b.asset.toLowerCase() : old.asset;
    const currency = ["usd","idr"].includes(String(b.currency).toLowerCase()) ? String(b.currency).toLowerCase() : old.currency;
    const interval = Math.max(1, Math.min(1440, Number(b.intervalMinutes) || old.interval_minutes));
    const above = numOrNull(b.alertAbove);
    const below = numOrNull(b.alertBelow);
    const changePct = Math.max(0, Math.min(100, Number(b.changeAlertPct ?? old.change_alert_pct) || 0));
    await env.DB.prepare(`UPDATE settings SET enabled=?,asset=?,currency=?,interval_minutes=?,alert_above=?,alert_below=?,change_alert_pct=?,ai_analysis=?,updated_at=? WHERE id=1`)
      .bind(b.enabled === undefined ? old.enabled : (b.enabled ? 1:0), asset,currency,interval,above,below,changePct,
        b.aiAnalysis === undefined ? old.ai_analysis : (b.aiAnalysis ? 1:0),now()).run();
    await log(env, `Mission settings saved; monitoring ${(b.enabled ?? !!old.enabled) ? "enabled":"disabled"}.`);
    return json({ ok:true });
  }
  if (request.method === "POST" && url.pathname === "/api/check-now") {
    try {
      const s = await getSettings(env);
      // Manual run allowed even if scheduler is paused.
      if (!s.enabled) await env.DB.prepare("UPDATE settings SET enabled=1 WHERE id=1").run();
      const result = await cycle(env);
      if (!s.enabled) await env.DB.prepare("UPDATE settings SET enabled=0 WHERE id=1").run();
      return json(result);
    } catch (e) { await log(env, e.message, "error"); return json({ok:false,error:e.message}, 502); }
  }
  if (request.method === "POST" && url.pathname === "/api/alerts/clear") {
    await env.DB.prepare("DELETE FROM alerts").run(); return json({ok:true});
  }
  if (request.method === "POST" && url.pathname === "/api/memory/clear") {
    await env.DB.prepare("DELETE FROM memory").run(); return json({ok:true});
  }
  return json({error:"Not found"},404);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env); }
      catch (e) { return json({error:e.message || "Internal error"},500); }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async()=>{
      try {
        const s=await getSettings(env);
        if (!s.enabled) return;
        // Cron triggers every 5 minutes; honor user interval by checking last snapshot timestamp.
        const last=await env.DB.prepare("SELECT fetched_at FROM snapshots WHERE asset=? ORDER BY id DESC LIMIT 1").bind(s.asset).first();
        const elapsed=last ? (Date.now()-new Date(last.fetched_at).getTime())/60000 : Infinity;
        if (elapsed >= Math.max(1,Number(s.interval_minutes)||5)) await cycle(env);
      } catch(e) { await log(env,`Scheduled cycle failed: ${e.message}`,"error"); }
    })());
  }
};
