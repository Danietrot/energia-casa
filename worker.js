const DEFAULT_CHANNEL_ID = "3493335";
const DEFAULT_TIME_ZONE = "Europe/Rome";
const MAX_RANGE_DAYS_PER_REQUEST = 14;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function text(body, contentType = "text/plain; charset=utf-8", status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}

function tsFormat(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function numeric(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function thingSpeakFetch(env, endpoint, params = {}) {
  if (!env.THINGSPEAK_READ_API_KEY) throw new Error("THINGSPEAK_READ_API_KEY non configurata.");
  const channelId = env.THINGSPEAK_CHANNEL_ID || DEFAULT_CHANNEL_ID;
  const u = new URL("https://api.thingspeak.com/channels/" + channelId + endpoint);
  u.searchParams.set("api_key", env.THINGSPEAK_READ_API_KEY);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  });

  const r = await fetch(u.toString(), {
    headers: { "user-agent": "EnergiaCasaDashboard/1.0" },
  });
  if (!r.ok) throw new Error("ThingSpeak HTTP " + r.status);
  const data = await r.json();
  if (data === -1) throw new Error("ThingSpeak: accesso negato al canale.");
  return data;
}

async function fetchField2Range(env, start, end) {
  // Recupera il contatore energia in blocchi inferiori al limite di 8000 punti.
  const out = [];
  let cursor = new Date(start);
  const final = new Date(end);
  const chunkMs = MAX_RANGE_DAYS_PER_REQUEST * 24 * 3600 * 1000;

  while (cursor < final) {
    const next = new Date(Math.min(cursor.getTime() + chunkMs, final.getTime()));
    const data = await thingSpeakFetch(env, "/fields/2.json", {
      start: tsFormat(cursor),
      end: tsFormat(next),
      results: 8000,
    });
    if (Array.isArray(data.feeds)) out.push(...data.feeds);
    cursor = next;
  }

  const seen = new Set();
  return out
    .filter((f) => {
      const key = f.entry_id || f.created_at;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const p = {};
  for (const x of fmt.formatToParts(date)) {
    if (x.type !== "literal") p[x.type] = x.value;
  }
  return p;
}

function energyDeltas(feeds, rangeStart, rangeEnd) {
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const rows = [];
  for (let i = 1; i < feeds.length; i++) {
    const prev = numeric(feeds[i - 1].field2);
    const curr = numeric(feeds[i].field2);
    const t = new Date(feeds[i].created_at);
    if (prev === null || curr === null || !Number.isFinite(t.getTime())) continue;
    if (t.getTime() < startMs || t.getTime() >= endMs) continue;
    const dWh = curr - prev;
    // Se il contatore viene azzerato/riavviato, la differenza negativa viene ignorata.
    if (dWh >= 0) rows.push({ time: t, kwh: dWh / 1000 });
  }
  return rows;
}

async function apiLive(env) {
  const data = await thingSpeakFetch(env, "/feeds.json", { results: 2 });
  const feeds = data.feeds || [];
  const f = feeds[feeds.length - 1];
  if (!f) return json({ error: "Nessun dato disponibile" }, 404);
  return json({
    createdAt: f.created_at,
    entryId: f.entry_id,
    powerW: numeric(f.field1),
    energyWh: numeric(f.field2),
    currentA: numeric(f.field3),
    voltageV: numeric(f.field4),
    pf: numeric(f.field5),
    frequencyHz: numeric(f.field6),
    returnedWh: numeric(f.field7),
  });
}

async function apiDay(env, url) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!start || !end) return json({ error: "start/end mancanti" }, 400);

  const fetchStart = new Date(new Date(start).getTime() - 10 * 60 * 1000);
  const data = await thingSpeakFetch(env, "/feeds.json", {
    start: tsFormat(fetchStart),
    end: tsFormat(new Date(end)),
    results: 1000,
  });
  const feeds = (data.feeds || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const deltas = energyDeltas(feeds, start, end);
  const tz = env.TIME_ZONE || DEFAULT_TIME_ZONE;

  const hourlyMap = new Map();
  deltas.forEach((r) => {
    const p = localParts(r.time, tz);
    const h = Number(p.hour);
    hourlyMap.set(h, (hourlyMap.get(h) || 0) + r.kwh);
  });

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const points = feeds
    .filter((f) => {
      const t = new Date(f.created_at).getTime();
      return t >= startMs && t < endMs;
    })
    .map((f) => ({
      t: f.created_at,
      powerW: numeric(f.field1),
      currentA: numeric(f.field3),
      voltageV: numeric(f.field4),
      pf: numeric(f.field5),
      frequencyHz: numeric(f.field6),
    }));

  const powers = points.map((p) => p.powerW).filter(Number.isFinite);
  const totalKwh = deltas.reduce((s, r) => s + r.kwh, 0);
  const peakPowerW = powers.length ? Math.max(...powers) : null;
  const avgPowerW = powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : null;

  return json({
    totalKwh,
    peakPowerW,
    avgPowerW,
    points,
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      kwh: hourlyMap.get(hour) || 0,
    })),
    firstAvailable: feeds[0]?.created_at || null,
    lastAvailable: feeds[feeds.length - 1]?.created_at || null,
  });
}

async function apiSummary(env, url) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const group = url.searchParams.get("group");
  if (!start || !end || !["day", "month"].includes(group)) {
    return json({ error: "Parametri start/end/group non validi" }, 400);
  }

  const fetchStart = new Date(new Date(start).getTime() - 10 * 60 * 1000);
  const feeds = await fetchField2Range(env, fetchStart, new Date(end));
  const deltas = energyDeltas(feeds, start, end);
  const tz = env.TIME_ZONE || DEFAULT_TIME_ZONE;
  const buckets = new Map();

  for (const r of deltas) {
    const p = localParts(r.time, tz);
    const key = group === "day"
      ? p.year + "-" + p.month + "-" + p.day
      : p.year + "-" + p.month;
    buckets.set(key, (buckets.get(key) || 0) + r.kwh);
  }

  const series = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, kwh]) => ({ key, kwh }));

  return json({
    totalKwh: series.reduce((s, x) => s + x.kwh, 0),
    series,
    firstAvailable: feeds[0]?.created_at || null,
    lastAvailable: feeds[feeds.length - 1]?.created_at || null,
  });
}

async function getTariffs(env) {
  const raw = await env.ENERGY_KV.get("tariffs");
  return raw ? JSON.parse(raw) : {};
}

async function apiTariffs(request, env) {
  if (request.method === "GET") return json(await getTariffs(env));

  if (request.method === "PUT") {
    const body = await request.json().catch(() => null);
    if (!body || !/^\d{4}-\d{2}$/.test(body.month || "")) {
      return json({ error: "Mese non valido. Usa YYYY-MM." }, 400);
    }
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 10) {
      return json({ error: "Tariffa non valida." }, 400);
    }

    const tariffs = await getTariffs(env);
    tariffs[body.month] = {
      rate,
      updatedAt: new Date().toISOString(),
    };
    await env.ENERGY_KV.put("tariffs", JSON.stringify(tariffs));
    return json(tariffs);
  }

  if (request.method === "DELETE") {
    const body = await request.json().catch(() => null);
    if (!body || !/^\d{4}-\d{2}$/.test(body.month || "")) {
      return json({ error: "Mese non valido." }, 400);
    }
    const tariffs = await getTariffs(env);
    delete tariffs[body.month];
    await env.ENERGY_KV.put("tariffs", JSON.stringify(tariffs));
    return json(tariffs);
  }

  return json({ error: "Metodo non consentito" }, 405);
}

const MANIFEST = JSON.stringify({
  name: "Energia Casa",
  short_name: "Energia",
  start_url: "/",
  display: "standalone",
  background_color: "#0b0f14",
  theme_color: "#0b0f14",
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
  ]
});

const ICON = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0b0f14"/>
  <path d="M292 52 129 286h108l-27 174 173-257H270z" fill="#4cc9f0"/>
  <circle cx="256" cy="256" r="218" fill="none" stroke="#202a36" stroke-width="10"/>
</svg>`;

const SW = `
const CACHE='energia-casa-v1';
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/','/manifest.webmanifest','/icon.svg']))));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
`;

const HTML = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<title>Energia Casa</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<style>
:root{
  --bg:#0b0f14;--panel:#111821;--panel2:#161f2a;--text:#f5f7fa;--muted:#8f9baa;
  --accent:#4cc9f0;--accent2:#7be495;--danger:#ff6b6b;--border:#24303d;
  --shadow:0 12px 30px rgba(0,0,0,.28)
}
*{box-sizing:border-box} body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
button,input,select{font:inherit}.wrap{max-width:1180px;margin:auto;padding:18px}
header{display:flex;gap:14px;justify-content:space-between;align-items:center;margin-bottom:18px}
.brand{display:flex;gap:12px;align-items:center}.logo{width:42px;height:42px;border-radius:14px;background:var(--panel2);display:grid;place-items:center;border:1px solid var(--border)}
.brand h1{font-size:1.25rem;margin:0}.sub{color:var(--muted);font-size:.86rem;margin-top:2px}
.actions{display:flex;gap:8px}.btn{border:1px solid var(--border);background:var(--panel);color:var(--text);padding:9px 12px;border-radius:12px;cursor:pointer}.btn.primary{background:var(--accent);color:#041017;border-color:transparent;font-weight:700}.btn.danger{color:#ffd7d7}
.statusdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent2);margin-right:6px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:linear-gradient(180deg,var(--panel),#0f151d);border:1px solid var(--border);border-radius:18px;padding:16px;box-shadow:var(--shadow)}
.klabel{color:var(--muted);font-size:.82rem}.kvalue{font-size:1.8rem;font-weight:800;letter-spacing:-.03em;margin-top:7px}.ksub{color:var(--muted);font-size:.78rem;margin-top:5px}
.tabs{display:flex;gap:8px;margin:16px 0 12px}.tab{padding:9px 13px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer}.tab.active{background:var(--panel2);color:var(--text);border-color:#344253}
.section{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:12px}.chartcard{min-height:390px}.charthead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}.charttitle{font-weight:750}.chartmeta{font-size:.8rem;color:var(--muted);margin-top:3px}
.chart{width:100%;height:295px;display:block}.tablewrap{max-height:330px;overflow:auto;border-radius:12px;border:1px solid var(--border)}
table{width:100%;border-collapse:collapse;font-size:.86rem}th,td{padding:10px 11px;border-bottom:1px solid var(--border);text-align:right}th:first-child,td:first-child{text-align:left}th{position:sticky;top:0;background:var(--panel2);color:var(--muted);font-weight:600}
.notice{margin-top:12px;color:var(--muted);font-size:.8rem}.empty{display:grid;place-items:center;height:250px;color:var(--muted);text-align:center;padding:24px}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.66);display:none;align-items:center;justify-content:center;padding:16px;z-index:30}.modal.show{display:flex}.modalbox{width:min(620px,100%);max-height:88vh;overflow:auto;background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:18px;box-shadow:var(--shadow)}
.modalhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.modalhead h2{font-size:1.05rem;margin:0}.x{background:transparent;color:var(--muted);border:0;font-size:1.4rem;cursor:pointer}
.formrow{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:12px}.field{display:flex;flex-direction:column;gap:6px}.field label{font-size:.78rem;color:var(--muted)}.field input{background:#0d131b;border:1px solid var(--border);color:var(--text);padding:10px 11px;border-radius:11px}
.tariffrow{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}.pill{font-size:.78rem;background:#0d131b;border:1px solid var(--border);padding:7px 9px;border-radius:10px}
.loginbox{width:min(420px,100%)}.loginbox p{color:var(--muted);line-height:1.45}.loginbox input{width:100%;margin:8px 0 12px;background:#0d131b;border:1px solid var(--border);color:var(--text);padding:12px;border-radius:12px}
.spinner{width:18px;height:18px;border:2px solid #3a4654;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;display:inline-block;vertical-align:-4px;margin-right:7px}@keyframes spin{to{transform:rotate(360deg)}}
footer{color:var(--muted);font-size:.75rem;text-align:center;padding:22px 0}
@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}.section{grid-template-columns:1fr}.chartcard{min-height:350px}.chart{height:260px}}
@media(max-width:520px){.wrap{padding:12px}.grid{gap:8px}.card{padding:13px;border-radius:15px}.kvalue{font-size:1.45rem}.actions .btn span{display:none}.formrow{grid-template-columns:1fr 1fr}.formrow .btn{grid-column:1/-1}.tariffrow{grid-template-columns:1fr 1fr auto}header{align-items:flex-start}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand">
    <div class="logo"><img src="/icon.svg" width="29" height="29" alt=""></div>
    <div><h1>Energia Casa</h1><div class="sub"><span class="statusdot"></span><span id="status">Connessione…</span></div></div>
  </div>
  <div class="actions">
    <button class="btn" id="refreshBtn">↻ <span>Aggiorna</span></button>
    <button class="btn" id="settingsBtn">⚙ <span>Tariffe</span></button>
  </div>
</header>

<div class="grid">
  <div class="card"><div class="klabel">Potenza attuale</div><div class="kvalue" id="powerNow">—</div><div class="ksub" id="liveTime">—</div></div>
  <div class="card"><div class="klabel">Costo teorico ora</div><div class="kvalue" id="costHour">—</div><div class="ksub" id="currentRate">Tariffa non impostata</div></div>
  <div class="card"><div class="klabel">Consumo oggi</div><div class="kvalue" id="todayKwh">—</div><div class="ksub" id="todayCost">—</div></div>
  <div class="card"><div class="klabel">Consumo mese</div><div class="kvalue" id="monthKwh">—</div><div class="ksub" id="monthCost">—</div></div>
</div>

<div class="tabs">
  <button class="tab active" data-tab="day">Oggi</button>
  <button class="tab" data-tab="month">Mese</button>
  <button class="tab" data-tab="year">Anno</button>
</div>

<div class="section">
  <div class="card chartcard">
    <div class="charthead">
      <div><div class="charttitle" id="chartTitle">Potenza di oggi</div><div class="chartmeta" id="chartMeta">—</div></div>
      <div class="pill" id="periodTotal">—</div>
    </div>
    <div id="chartHost" class="empty"><span><span class="spinner"></span>Caricamento dati…</span></div>
    <div class="notice" id="coverageNote"></div>
  </div>
  <div class="card">
    <div class="charttitle" id="tableTitle">Consumo per ora</div>
    <div class="chartmeta" style="margin-bottom:10px" id="tableMeta">kWh e costo stimato</div>
    <div class="tablewrap">
      <table><thead><tr><th id="colPeriod">Ora</th><th>kWh</th><th>€</th></tr></thead><tbody id="detailBody"></tbody></table>
    </div>
  </div>
</div>
<footer>Dati Shelly Pro EM-50 → ThingSpeak • Fuso Europe/Rome</footer>
</div>

<div class="modal" id="settingsModal">
  <div class="modalbox">
    <div class="modalhead"><h2>Tariffe energia</h2><button class="x" id="closeSettings">×</button></div>
    <div class="notice" style="margin:0 0 14px">Inserisci il costo complessivo che vuoi attribuire a 1 kWh per ciascun mese. Le tariffe restano storicizzate per mese.</div>
    <div class="formrow">
      <div class="field"><label>Mese</label><input id="newMonth" type="month"></div>
      <div class="field"><label>€/kWh</label><input id="newRate" type="number" step="0.0001" min="0" placeholder="0,2500"></div>
      <button class="btn primary" id="saveRate">Salva</button>
    </div>
    <div id="tariffList"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button class="btn" id="closeSettings2">Chiudi</button>
    </div>
  </div>
</div>

<script>
const TZ='Europe/Rome';
const state={tariffs:{},tab:'day',live:null,day:null,month:null,year:null};

const $=s=>document.querySelector(s);
const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('it-IT',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const money=n=>Number.isFinite(n)?n.toLocaleString('it-IT',{style:'currency',currency:'EUR'}):'—';
const rateFor=key=>state.tariffs[key] && Number.isFinite(Number(state.tariffs[key].rate)) ? Number(state.tariffs[key].rate) : null;
const monthKeyFromDate=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');

function startOfDay(d){const x=new Date(d);x.setHours(0,0,0,0);return x}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1,0,0,0,0)}
function startOfYear(d){return new Date(d.getFullYear(),0,1,0,0,0,0)}
function nextMonth(d){return new Date(d.getFullYear(),d.getMonth()+1,1,0,0,0,0)}
function nextYear(d){return new Date(d.getFullYear()+1,0,1,0,0,0,0)}

async function api(path,opts={}){
  const r=await fetch(path,opts);
  const data=await r.json().catch(()=>({error:'Risposta non valida'}));
  if(!r.ok) throw new Error(data.error||('HTTP '+r.status));
  return data;
}

function setStatus(txt,ok=true){$('#status').textContent=txt;document.querySelector('.statusdot').style.background=ok?'var(--accent2)':'var(--danger)'}

async function loadTariffs(){state.tariffs=await api('/api/tariffs');renderTariffs()}

async function loadLive(){
  state.live=await api('/api/live');
  const f=state.live;
  $('#powerNow').textContent=f.powerW>=1000?fmt(f.powerW/1000,2)+' kW':fmt(f.powerW,0)+' W';
  $('#liveTime').textContent='Agg. '+new Date(f.createdAt).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  const mk=monthKeyFromDate(new Date());
  const rate=rateFor(mk);
  $('#currentRate').textContent=rate===null?'Tariffa '+mk+' non impostata':'Tariffa '+fmt(rate,4)+' €/kWh';
  $('#costHour').textContent=(rate!==null&&Number.isFinite(f.powerW))?money((f.powerW/1000)*rate)+'/h':'—';
  setStatus('Online • ultimo dato '+new Date(f.createdAt).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}),true);
}

async function loadDay(){
  const now=new Date(),start=startOfDay(now),end=now;
  state.day=await api('/api/day?start='+encodeURIComponent(start.toISOString())+'&end='+encodeURIComponent(end.toISOString()));
  const rate=rateFor(monthKeyFromDate(now));
  $('#todayKwh').textContent=fmt(state.day.totalKwh,3)+' kWh';
  $('#todayCost').textContent=rate===null?'Tariffa non impostata':money(state.day.totalKwh*rate);
}

async function loadMonth(){
  const now=new Date(),start=startOfMonth(now),end=now;
  state.month=await api('/api/summary?group=day&start='+encodeURIComponent(start.toISOString())+'&end='+encodeURIComponent(end.toISOString()));
  const rate=rateFor(monthKeyFromDate(now));
  $('#monthKwh').textContent=fmt(state.month.totalKwh,2)+' kWh';
  $('#monthCost').textContent=rate===null?'Tariffa non impostata':money(state.month.totalKwh*rate);
}

async function loadYear(){
  const now=new Date(),start=startOfYear(now),end=now;
  state.year=await api('/api/summary?group=month&start='+encodeURIComponent(start.toISOString())+'&end='+encodeURIComponent(end.toISOString()));
}

function lineChart(points){
  const vals=points.filter(x=>Number.isFinite(x.powerW));
  if(!vals.length)return '<div class="empty">Nessun dato disponibile.</div>';
  const W=900,H=290,pad={l:52,r:15,t:16,b:34};const innerW=W-pad.l-pad.r,innerH=H-pad.t-pad.b;
  const max=Math.max(500,...vals.map(x=>x.powerW))*1.08;const minT=new Date(vals[0].t).getTime(),maxT=new Date(vals[vals.length-1].t).getTime()||minT+1;
  const x=t=>pad.l+((new Date(t).getTime()-minT)/(maxT-minT||1))*innerW;
  const y=v=>pad.t+innerH-(v/max)*innerH;
  let grid='',labels='';
  for(let i=0;i<=4;i++){const yy=pad.t+innerH*i/4;const v=max*(1-i/4);grid+='<line x1="'+pad.l+'" y1="'+yy+'" x2="'+(W-pad.r)+'" y2="'+yy+'" stroke="#24303d"/>';labels+='<text x="'+(pad.l-8)+'" y="'+(yy+4)+'" text-anchor="end" fill="#8f9baa" font-size="12">'+Math.round(v)+'</text>'}
  for(let h=0;h<=24;h+=4){const xx=pad.l+innerW*h/24;labels+='<text x="'+xx+'" y="'+(H-9)+'" text-anchor="middle" fill="#8f9baa" font-size="12">'+String(h).padStart(2,'0')+'</text>'}
  const pts=vals.map(v=>x(v.t).toFixed(1)+','+y(v.powerW).toFixed(1)).join(' ');
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+grid+labels+'<polyline fill="none" stroke="#4cc9f0" stroke-width="3" vector-effect="non-scaling-stroke" points="'+pts+'"/></svg>';
}

function barChart(rows,labelFn){
  const vals=rows.filter(x=>Number.isFinite(x.kwh));
  if(!vals.length)return '<div class="empty">Nessun dato disponibile.</div>';
  const W=900,H=290,pad={l:52,r:15,t:16,b:42},innerW=W-pad.l-pad.r,innerH=H-pad.t-pad.b;const max=Math.max(.1,...vals.map(x=>x.kwh))*1.12;
  let grid='',labels='',bars='';for(let i=0;i<=4;i++){const yy=pad.t+innerH*i/4;const v=max*(1-i/4);grid+='<line x1="'+pad.l+'" y1="'+yy+'" x2="'+(W-pad.r)+'" y2="'+yy+'" stroke="#24303d"/>';labels+='<text x="'+(pad.l-8)+'" y="'+(yy+4)+'" text-anchor="end" fill="#8f9baa" font-size="12">'+fmt(v,1)+'</text>'}
  const slot=innerW/vals.length,bw=Math.max(3,slot*.62);
  vals.forEach((r,i)=>{const hh=(r.kwh/max)*innerH,xx=pad.l+i*slot+(slot-bw)/2,yy=pad.t+innerH-hh;bars+='<rect x="'+xx+'" y="'+yy+'" width="'+bw+'" height="'+hh+'" rx="3" fill="#4cc9f0"/>';const every=vals.length>20?5:1;if(i%every===0||i===vals.length-1)labels+='<text x="'+(pad.l+i*slot+slot/2)+'" y="'+(H-12)+'" text-anchor="middle" fill="#8f9baa" font-size="11">'+labelFn(r,i)+'</text>'});
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+grid+labels+bars+'</svg>';
}

function renderDay(){
  const d=state.day;if(!d)return;const rate=rateFor(monthKeyFromDate(new Date()));
  $('#chartTitle').textContent='Potenza di oggi';$('#chartMeta').textContent='Campioni ogni 5 minuti';$('#periodTotal').textContent=fmt(d.totalKwh,3)+' kWh';
  $('#chartHost').className='';$('#chartHost').innerHTML=lineChart(d.points||[]);
  $('#tableTitle').textContent='Consumo per ora';$('#colPeriod').textContent='Ora';
  $('#detailBody').innerHTML=d.hourly.map(x=>'<tr><td>'+String(x.hour).padStart(2,'0')+':00–'+String((x.hour+1)%24).padStart(2,'0')+':00</td><td>'+fmt(x.kwh,3)+'</td><td>'+(rate===null?'—':money(x.kwh*rate))+'</td></tr>').join('');
  $('#coverageNote').textContent=d.firstAvailable?'Dati disponibili nel periodo da '+new Date(d.firstAvailable).toLocaleString('it-IT')+'.':'';
}

function renderMonth(){
  const d=state.month;if(!d)return;const now=new Date(),rate=rateFor(monthKeyFromDate(now));
  $('#chartTitle').textContent='Consumo del mese';$('#chartMeta').textContent=now.toLocaleDateString('it-IT',{month:'long',year:'numeric'});$('#periodTotal').textContent=fmt(d.totalKwh,2)+' kWh';
  $('#chartHost').className='';$('#chartHost').innerHTML=barChart(d.series,r=>String(Number(r.key.slice(-2))));
  $('#tableTitle').textContent='Consumo per giorno';$('#colPeriod').textContent='Giorno';
  $('#detailBody').innerHTML=d.series.map(x=>'<tr><td>'+x.key.split('-').reverse().join('/')+'</td><td>'+fmt(x.kwh,2)+'</td><td>'+(rate===null?'—':money(x.kwh*rate))+'</td></tr>').join('');
  $('#coverageNote').textContent=d.firstAvailable?'Il totale usa il contatore cumulativo Shelly e considera solo il periodo già registrato in ThingSpeak.':'';
}

function renderYear(){
  const d=state.year;if(!d)return;const now=new Date();
  $('#chartTitle').textContent='Consumo dell’anno';$('#chartMeta').textContent=String(now.getFullYear());$('#periodTotal').textContent=fmt(d.totalKwh,1)+' kWh';
  $('#chartHost').className='';$('#chartHost').innerHTML=barChart(d.series,r=>['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][Number(r.key.slice(-2))-1]);
  $('#tableTitle').textContent='Consumo per mese';$('#colPeriod').textContent='Mese';
  $('#detailBody').innerHTML=d.series.map(x=>{const rate=rateFor(x.key);const date=new Date(Number(x.key.slice(0,4)),Number(x.key.slice(5,7))-1,1);return '<tr><td>'+date.toLocaleDateString('it-IT',{month:'long'})+'</td><td>'+fmt(x.kwh,2)+'</td><td>'+(rate===null?'—':money(x.kwh*rate))+'</td></tr>'}).join('');
  const annualCost=d.series.reduce((s,x)=>{const r=rateFor(x.key);return s+(r===null?0:x.kwh*r)},0);
  const missing=d.series.filter(x=>rateFor(x.key)===null).length;
  $('#coverageNote').textContent=(missing?'Mancano '+missing+' tariffe mensili: il costo annuale non è completo. ':'')+'Costo noto: '+money(annualCost)+'.';
}

function renderCurrentTab(){if(state.tab==='day')renderDay();else if(state.tab==='month')renderMonth();else renderYear()}

function renderTariffs(){
  const entries=Object.entries(state.tariffs).sort((a,b)=>b[0].localeCompare(a[0]));
  $('#tariffList').innerHTML=entries.length?entries.map(([m,v])=>'<div class="tariffrow"><div>'+m+'</div><div><b>'+fmt(Number(v.rate),4)+'</b> €/kWh</div><button class="btn danger" data-del="'+m+'">Elimina</button></div>').join(''):'<div class="empty" style="height:120px">Nessuna tariffa inserita.</div>';
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Eliminare la tariffa '+b.dataset.del+'?'))return;await api('/api/tariffs',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({month:b.dataset.del})});await loadTariffs();await refreshAll()});
}

async function refreshAll(){
  setStatus('Aggiornamento…',true);
  try{
    await Promise.all([loadLive(),loadDay(),loadMonth()]);
    if(state.tab==='year')await loadYear();
    renderCurrentTab();
  }catch(e){setStatus(e.message,false)}
}

document.querySelectorAll('.tab').forEach(b=>b.onclick=async()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.tab=b.dataset.tab;if(state.tab==='year'&&!state.year){$('#chartHost').className='empty';$('#chartHost').innerHTML='<span><span class="spinner"></span>Caricamento anno…</span>';try{await loadYear()}catch(e){setStatus(e.message,false)}}renderCurrentTab()});
$('#refreshBtn').onclick=refreshAll;
$('#settingsBtn').onclick=()=>{$('#settingsModal').classList.add('show');renderTariffs()};
$('#closeSettings').onclick=$('#closeSettings2').onclick=()=>$('#settingsModal').classList.remove('show');
$('#saveRate').onclick=async()=>{const month=$('#newMonth').value,raw=$('#newRate').value.replace(',','.');const rate=Number(raw);if(!month||!Number.isFinite(rate)){alert('Inserisci mese e tariffa.');return}await api('/api/tariffs',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({month,rate})});$('#newRate').value='';await loadTariffs();await refreshAll()};
$('#newMonth').value=monthKeyFromDate(new Date());

(async()=>{
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  try{await loadTariffs();await refreshAll()}catch(e){setStatus(e.message,false)}
  setInterval(()=>{loadLive().catch(()=>{})},60000);
})();
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        if (!env.ENERGY_KV) return json({ error: "Binding ENERGY_KV non configurato." }, 500);

        if (url.pathname === "/api/live" && request.method === "GET") return await apiLive(env);
        if (url.pathname === "/api/day" && request.method === "GET") return await apiDay(env, url);
        if (url.pathname === "/api/summary" && request.method === "GET") return await apiSummary(env, url);
        if (url.pathname === "/api/tariffs") return await apiTariffs(request, env);
        return json({ error: "Endpoint non trovato" }, 404);
      }

      if (url.pathname === "/manifest.webmanifest") return text(MANIFEST, "application/manifest+json; charset=utf-8");
      if (url.pathname === "/sw.js") return text(SW, "application/javascript; charset=utf-8");
      if (url.pathname === "/icon.svg") return text(ICON, "image/svg+xml; charset=utf-8");
      return text(HTML, "text/html; charset=utf-8");
    } catch (e) {
      return json({ error: e && e.message ? e.message : "Errore interno" }, 500);
    }
  }
};
