// Dashboard soldi/lead per l'ufficio (e per la TV), stile Liquid Glass con Napoleone di sfondo.
// Pagine: /dashboardvenditatop    = PC, si vedono i numeri e si registrano clienti e spesa ads
//         /dashboardvenditatop/tv = TV, solo visualizzazione (anche /tv)
// Dati nel KV ACADEMY_PROGRESS, chiave "fatturato:AAAA-MM-GG" (giorno di Roma):
//   clients  = nuovi clienti pagati (nome, importo): l'incassato del giorno è la loro somma
//   adsSpend = spesa ads del giorno (a mano)
// Lead arrivati e lead da chiamare arrivano dal foglio Google (vedi readSheet).

export const DASH_PATH = "/dashboardvenditatop";
export const TV_PATH = "/tv";

// Password di accesso: salvata solo come hash PBKDF2. Per cambiarla chiedi a Claude un nuovo hash.
const DASH_SALT = "dc9c1720bf64430ece096b2650befaac";
const DASH_HASH = "ac7f198145ddd36f9805c116254d3ae88b0df25100e68c158b521ae2c62d4db8";
const DASH_COOKIE = "vu_dash_session";
const DASH_SESSION_DAYS = 365;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkDashPassword(password) {
  const clean = password.toLowerCase().replace(/[\s-]/g, "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(clean), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(DASH_SALT), iterations: 100000 },
    key, 256
  );
  return toHex(bits) === DASH_HASH;
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

// Le sessioni sono token casuali salvati nel KV, così non dipendono da segreti nel codice.
async function isLoggedIn(request, kv) {
  const token = getCookie(request, DASH_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  return (await kv.get(`dashsess:${token}`)) !== null;
}

const ROME_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" });
const romeDate = () => ROME_DAY.format(new Date());
const pad2 = (n) => String(n).padStart(2, "0");

function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const round2 = (n) => Math.round(n * 100) / 100;
const num = (n) => (isFinite(n) ? round2(n) : 0);

async function readDay(kv, date) {
  const raw = await kv.get(`fatturato:${date}`);
  if (!raw) return null;
  const d = JSON.parse(raw);
  const clients = Array.isArray(d.clients) ? d.clients.map((c) => ({
    id: String(c.id || "").slice(0, 20), name: String(c.name || "").slice(0, 80), amount: num(c.amount), ts: Number(c.ts) || 0,
  })) : [];
  return { clients, adsSpend: num(d.adsSpend), leads: num(d.leads), toCall: num(d.toCall) };
}

const dayCashed = (day) => round2((day ? day.clients || [] : []).reduce((s, c) => s + (c.amount || 0), 0));

const EMPTY_DAY = { clients: [], adsSpend: 0, leads: 0, toCall: 0 };
const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });

// Foglio Google "Vendita Uno – Gestione Lead" (condiviso: chiunque abbia il link può vedere).
// Tab LEAD: col A id lead (l:...), col B data/ora Facebook, col P nome.
// Tab KPI: riga "Lead senza stato" = lead ancora da chiamare.
// Tab APPUNTAMENTI FISSATI: col A nome, usato per suggerire i nomi dei nuovi clienti.
const SHEET_ID = "11tIi1O0MN8JqEZbuzI-ensYC7aPpb0GIym3IWRmAqf8";

function sheetUrl(sheet, tq, headers) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=${headers}&sheet=${encodeURIComponent(sheet)}&tq=${encodeURIComponent(tq)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchCsv(url) {
  // cacheTtl: Cloudflare tiene la risposta 60 secondi, così il refresh ogni pochi secondi non martella Google.
  const r = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!r.ok) throw new Error(`foglio ${r.status}`);
  if ((r.headers.get("content-type") || "").includes("text/html")) throw new Error("foglio non condiviso");
  return parseCsv(await r.text());
}

async function readSheet() {
  const [leadRows, appRows, kpiRows] = await Promise.all([
    fetchCsv(sheetUrl("LEAD", "select A, B, P", 0)),
    fetchCsv(sheetUrl("APPUNTAMENTI FISSATI", "select A", 1)),
    fetchCsv(sheetUrl("KPI", "select C where B = 'Lead senza stato'", 1)),
  ]);
  const leadsByDay = {}, leadNames = [];
  for (const [id, created, name] of leadRows) {
    if (!/^l:/.test(id || "")) continue;
    const t = new Date(created);
    if (isNaN(t)) continue;
    const day = ROME_DAY.format(t);
    leadsByDay[day] = (leadsByDay[day] || 0) + 1;
    if (name && name.trim()) leadNames.push(name.trim());
  }
  const appNames = appRows.map((r) => (r[0] || "").trim()).filter((n) => n && n.toUpperCase() !== "NOME");
  const toCallCell = kpiRows.map((r) => (r[0] || "").trim()).find((v) => v !== "" && isFinite(Number(v.replace(",", "."))));
  return {
    leadsByDay,
    toCall: toCallCell !== undefined ? Number(toCallCell.replace(",", ".")) : null,
    names: [...new Set([...appNames, ...leadNames])].slice(0, 400),
  };
}

async function monthPayload(kv, ym, today, sheet = null) {
  const nDays = daysInMonth(ym);
  const dates = Array.from({ length: nDays }, (_, i) => `${ym}-${pad2(i + 1)}`);
  const records = await Promise.all(dates.map((d) => readDay(kv, d)));
  const days = {};
  dates.forEach((d, i) => { if (records[i]) days[d] = records[i]; });

  const todayYm = today.slice(0, 7);
  const upTo = ym === todayYm ? Number(today.slice(8, 10)) : ym > todayYm ? 0 : nDays;
  const pastDates = dates.slice(0, upTo);
  // I lead arrivano dal foglio Google; se il foglio non risponde si usano quelli salvati (se ci sono).
  const leadsOn = (d, rec) => (sheet ? sheet.leadsByDay[d] || 0 : rec ? rec.leads || 0 : 0);

  const cashed = round2(pastDates.reduce((s, d) => s + dayCashed(days[d]), 0));
  const adsSpend = round2(pastDates.reduce((s, d) => s + (days[d] ? days[d].adsSpend : 0), 0));
  const leads = pastDates.reduce((s, d) => s + leadsOn(d, days[d]), 0);
  const clientsCount = pastDates.reduce((s, d) => s + (days[d] ? days[d].clients.length : 0), 0);

  // Proiezione: incassato finora / giorni passati x giorni del mese (non gonfiata dai giorni senza dati).
  let projection = null, projectionNote = null;
  if (ym === todayYm) {
    if (upTo < 3) projectionNote = "La proiezione parte dal 3 del mese";
    else if (cashed <= 0) projectionNote = "Nessun incasso ancora questo mese";
    else projection = round2((cashed / upTo) * nDays);
  }

  // "Oggi" e "ieri" sono sempre i giorni veri, anche quando si sfogliano i mesi passati.
  const yesterday = addDays(today, -1);
  const [todayRec, yRec] = await Promise.all([
    today.startsWith(ym) ? days[today] || null : readDay(kv, today),
    yesterday.startsWith(ym) ? days[yesterday] || null : readDay(kv, yesterday),
  ]);
  const todayData = todayRec || EMPTY_DAY;

  return {
    today,
    todayData: {
      clients: todayData.clients,
      cashed: dayCashed(todayData),
      adsSpend: todayData.adsSpend,
      leads: leadsOn(today, todayRec),
      toCall: sheet && sheet.toCall != null ? sheet.toCall : todayData.toCall,
    },
    yesterday: { cashed: dayCashed(yRec), leads: leadsOn(yesterday, yRec) },
    days,
    series: dates.map((d, i) => ({
      date: d, d: i + 1, today: d === today, future: d > today,
      cashed: dayCashed(days[d]), leads: leadsOn(d, days[d]),
    })),
    month: {
      ym, label: MONTH_LABEL.format(new Date(ym + "-01T12:00:00Z")),
      daysInMonth: nDays, elapsed: upTo,
      cashed, adsSpend, leads, clients: clientsCount,
      cpl: leads > 0 && adsSpend > 0 ? round2(adsSpend / leads) : null,
      cac: clientsCount > 0 && adsSpend > 0 ? round2(adsSpend / clientsCount) : null,
      roas: adsSpend > 0 ? round2(cashed / adsSpend) : null,
      projection, projectionNote,
      isCurrent: ym === todayYm, isFuture: ym > todayYm,
    },
    sheetOk: !!sheet,
    names: sheet ? sheet.names : [],
  };
}

async function payload(kv, ym, today) {
  const sheet = await readSheet().catch(() => null);
  return monthPayload(kv, ym, today, sheet);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function html(body) {
  return new Response(body, {
    headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" },
  });
}

const BASE_HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b0b10">
<link rel="icon" type="image/png" href="/assets/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">`;

// Stile Liquid Glass condiviso da login e dashboard.
const GLASS_CSS = `
  :root {
    --ink: #ffffff;
    --ink-2: rgba(255,255,255,0.76);
    --ink-3: rgba(255,255,255,0.52);
    --stroke: rgba(255,255,255,0.20);
    --gold: #b98318;
    --blue: #2a86c8;
    --good: #5be38a;
    --bad: #ff7a7a;
    --accent: #f3c766;
    --font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  html { background: #0b0b10; overflow-x: clip; }
  body { margin: 0; color: var(--ink); font-family: var(--font); -webkit-font-smoothing: antialiased; background: transparent; }
  .bg { position: fixed; inset: 0; z-index: -2; background: url(/assets/img/napoleone.jpg) 42% 30% / cover no-repeat; transform: scale(1.03); filter: saturate(1.12) contrast(1.04); }
  .bg::after { content: ""; position: absolute; inset: 0;
    background:
      radial-gradient(90% 70% at 38% 28%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.38) 62%, rgba(0,0,0,0.72) 100%),
      linear-gradient(180deg, rgba(8,8,14,0.25) 0%, rgba(8,8,14,0.15) 35%, rgba(8,8,14,0.65) 100%); }
  .glass {
    position: relative; isolation: isolate;
    background: linear-gradient(140deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.05) 42%, rgba(255,255,255,0.08) 100%), rgba(16,16,24,0.34);
    -webkit-backdrop-filter: blur(26px) saturate(175%); backdrop-filter: blur(26px) saturate(175%);
    border: 1px solid var(--stroke); border-radius: 28px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(255,255,255,0.08), inset 1px 0 0 rgba(255,255,255,0.10), 0 24px 60px -18px rgba(0,0,0,0.6);
  }
  .glass::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1;
    background: radial-gradient(120% 70% at 0% 0%, rgba(255,255,255,0.20), rgba(255,255,255,0) 48%), radial-gradient(80% 60% at 100% 100%, rgba(255,255,255,0.07), rgba(255,255,255,0) 60%); }
  .num { font-variant-numeric: tabular-nums; }
`;

function loginPage(error, tv = false) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Dashboard Vendita Uno · Accedi</title>
<style>
${GLASS_CSS}
  body { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
  form { width: 100%; max-width: 380px; padding: 36px 28px; text-align: center; }
  img.logo { height: 34px; margin: 0 auto 18px; display: block; }
  h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 6px; }
  p.sub { color: var(--ink-3); margin: 0 0 24px; font-size: 0.95rem; }
  input { width: 100%; padding: 15px 16px; font: inherit; font-size: 1.05rem; color: #fff; background: rgba(0,0,0,0.28); border: 1px solid var(--stroke); border-radius: 16px; margin-bottom: 14px; text-align: center; outline: none; }
  input:focus { border-color: rgba(255,255,255,0.5); }
  button { width: 100%; padding: 15px; font: inherit; font-size: 1.05rem; font-weight: 700; background: #fff; color: #000; border: 0; border-radius: 999px; cursor: pointer; }
  .err { color: var(--bad); margin: 0 0 14px; }
</style>
</head>
<body>
<div class="bg"></div>
<form class="glass" method="POST" action="${DASH_PATH}/login${tv ? "?tv=1" : ""}">
  <img class="logo" src="/assets/img/logo.png" alt="Vendita Uno">
  <h1>Dashboard</h1>
  <p class="sub">Conquistiamo.</p>
  ${error ? `<p class="err">${error}</p>` : ""}
  <input type="password" name="password" placeholder="Password" required autofocus autocomplete="current-password">
  <button type="submit">Entra</button>
</form>
</body>
</html>`;
}

// tv = true: solo visualizzazione, tutto in uno schermo. tv = false: pagina del PC con i moduli.
function dashboardPage(tv) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Dashboard Vendita Uno${tv ? " · TV" : ""}</title>
<style>
${GLASS_CSS}
  .wrap { max-width: 1480px; margin: 0 auto; padding: 22px 26px 40px; display: flex; flex-direction: column; gap: 18px; }

  /* Barra in alto */
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px 12px 20px; border-radius: 999px; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: -0.01em; }
  .brand img { height: 26px; }
  .when { display: flex; align-items: center; gap: 10px; color: var(--ink-2); font-weight: 600; }
  .when .clock { color: #fff; font-weight: 800; background: rgba(255,255,255,0.12); border: 1px solid var(--stroke); border-radius: 999px; padding: 6px 14px; }
  .alert { display: none; color: #fff; background: rgba(255,90,90,0.28); border: 1px solid rgba(255,120,120,0.55); border-radius: 999px; padding: 6px 12px; font-size: 0.82rem; font-weight: 700; }
  .alert.on { display: inline-flex; }

  /* Numeri principali */
  .tiles { display: grid; grid-template-columns: 1.25fr 1fr 1fr 1fr; gap: 18px; }
  .tile { padding: 22px 24px 20px; display: flex; flex-direction: column; min-width: 0; }
  .tile .label { font-size: 0.82rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-2); }
  .tile .big { font-size: clamp(2.2rem, 3.9vw, 4rem); font-weight: 800; letter-spacing: -0.035em; line-height: 1.05; margin: 10px 0 8px; text-shadow: 0 2px 24px rgba(0,0,0,0.35); white-space: nowrap; }
  .tile.hero .big { font-size: clamp(2.6rem, 5vw, 5.2rem); }
  .tile .sub { color: var(--ink-2); font-size: 0.95rem; font-weight: 500; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-top: auto; }
  .tile .sub b { color: #fff; font-weight: 700; }
  .up { color: var(--good); font-weight: 700; }
  .down { color: var(--bad); font-weight: 700; }
  .pill { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 999px; background: rgba(255,255,255,0.10); border: 1px solid var(--stroke); font-weight: 700; color: #fff; }
  .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--bad); box-shadow: 0 0 10px var(--bad); }
  .pill.ok .dot { background: var(--good); box-shadow: 0 0 10px var(--good); }
  .bump { animation: bump 1.1s ease-out; }
  @keyframes bump { 0% { transform: scale(1); } 18% { transform: scale(1.06); } 100% { transform: scale(1); } }

  /* Grafici + clienti */
  .main { display: grid; grid-template-columns: 2.2fr 1fr; grid-template-rows: auto auto; gap: 18px; }
  .card { padding: 20px 22px 16px; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .card-head h2 { margin: 0; font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em; }
  .card-head .meta { color: var(--ink-3); font-size: 0.88rem; margin-top: 3px; }
  .chart { position: relative; flex: 1; min-height: 240px; }
  .chart svg { display: block; overflow: visible; }
  .chart .grid { stroke: rgba(255,255,255,0.12); stroke-width: 1; }
  .chart .axis { fill: var(--ink-3); font-size: 11px; font-family: var(--font); }
  .chart .axis.today { fill: #fff; font-weight: 700; }
  .chart .val { fill: #fff; font-size: 12px; font-weight: 700; font-family: var(--font); }
  .chart .bar { fill: var(--gold); transition: opacity .15s; }
  .chart .bar.is-today { fill: #d39a24; }
  .chart.hovering .bar { opacity: 0.45; }
  .chart.hovering .bar.hot { opacity: 1; }
  .chart .line { fill: none; stroke: var(--blue); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .chart .cross { stroke: rgba(255,255,255,0.45); stroke-width: 1; }
  .chart .mk { fill: var(--blue); stroke: #15151c; stroke-width: 2; }
  .chart .hit { fill: transparent; cursor: default; }
  .chart .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-3); font-size: 0.95rem; text-align: center; padding: 0 20px; }
  .tip { position: absolute; pointer-events: none; transform: translate(-50%, calc(-100% - 10px)); padding: 8px 11px; border-radius: 12px; font-size: 0.85rem; white-space: nowrap; opacity: 0; transition: opacity .12s;
    background: rgba(20,20,28,0.78); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid var(--stroke); }
  .tip.on { opacity: 1; }
  .tip b { display: block; font-size: 1rem; }
  .tip span { color: var(--ink-3); }

  .monthnav { display: flex; align-items: center; gap: 8px; flex: none; }
  .monthnav button { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--stroke); background: rgba(255,255,255,0.10); color: #fff; font-size: 1.1rem; cursor: pointer; display: grid; place-items: center; }
  .monthnav button:disabled { opacity: 0.3; cursor: default; }
  .monthnav .lbl { font-weight: 700; text-transform: capitalize; min-width: 8.5em; text-align: center; }

  .side { grid-row: 1 / span 2; grid-column: 2; display: flex; flex-direction: column; gap: 18px; min-height: 0; min-width: 0; }
  .poster { flex: 0 0 auto; aspect-ratio: 16 / 10; max-height: 46%; overflow: hidden; padding: 0; }
  .poster .img { position: absolute; inset: 0; z-index: -2; border-radius: inherit; background: url(/assets/img/napoleone.jpg) 62% 22% / cover no-repeat; filter: saturate(1.12) contrast(1.06); }
  .poster::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.72) 100%); z-index: -1; }
  .poster .cap { position: absolute; left: 22px; right: 22px; bottom: 16px; }
  .poster .cap .m { font-weight: 900; font-size: clamp(1.4rem, 2.2vw, 2.3rem); letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); text-shadow: 0 2px 20px rgba(0,0,0,0.7); line-height: 1; }
  .poster .cap .s { color: var(--ink-2); font-size: 0.86rem; font-weight: 600; margin-top: 6px; text-shadow: 0 1px 8px rgba(0,0,0,0.8); }
  .clients-card { flex: 1; }
  .clients { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; min-height: 0; flex: 1; }
  .cl { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); }
  .cl .av { width: 38px; height: 38px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #1a1205; background: linear-gradient(140deg, #f6d27a, #b98318); }
  .cl .who { flex: 1; min-width: 0; }
  .cl .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cl .time { color: var(--ink-3); font-size: 0.8rem; }
  .cl .amt { font-weight: 800; font-size: 1.05rem; }
  .cl .del { background: none; border: 1px solid rgba(255,120,120,0.5); color: var(--bad); cursor: pointer; font: inherit; font-size: 0.78rem; font-weight: 700; padding: 5px 10px; border-radius: 999px; flex: none; }
  .cl .del.sure { background: #e5484d; border-color: #e5484d; color: #fff; }
  .cl.new { animation: newcl 1.4s ease-out; }
  @keyframes newcl { 0% { transform: scale(0.96); background: rgba(243,199,102,0.45); } 100% { transform: scale(1); } }
  .clients .none { color: var(--ink-3); padding: 18px 4px; }

  /* Annuncio nuovo cliente */
  .toast { position: fixed; left: 50%; top: 42%; z-index: 20; transform: translate(-50%, -50%) scale(0.92); opacity: 0; pointer-events: none; text-align: center; padding: 26px 40px; border-radius: 34px; transition: opacity .4s, transform .4s; }
  .toast.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  .toast .k { color: var(--accent); font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; font-size: clamp(0.8rem, 1.2vw, 1.1rem); }
  .toast .n { font-size: clamp(1.8rem, 4vw, 4rem); font-weight: 800; letter-spacing: -0.03em; margin-top: 6px; }
  .toast .a { font-size: clamp(1.4rem, 3vw, 3rem); font-weight: 800; color: var(--good); }

  /* Moduli (solo PC) */
  .forms { display: grid; grid-template-columns: 1.3fr 1fr; gap: 18px; }
  .form { padding: 24px; }
  .form h2 { margin: 0 0 4px; font-size: 1.15rem; font-weight: 800; }
  .form .note { color: var(--ink-3); font-size: 0.86rem; margin: 0 0 18px; }
  .form label { display: block; font-size: 0.82rem; color: var(--ink-2); margin: 0 0 6px 4px; font-weight: 600; }
  .form input { width: 100%; padding: 14px 16px; font: inherit; font-size: 1.05rem; color: #fff; background: rgba(0,0,0,0.28); border: 1px solid var(--stroke); border-radius: 16px; margin-bottom: 14px; outline: none; color-scheme: dark; }
  .form input:focus { border-color: rgba(255,255,255,0.55); }
  .form .row { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; }
  .btn { width: 100%; padding: 15px; font: inherit; font-size: 1rem; font-weight: 700; border-radius: 999px; cursor: pointer; border: 0; background: #fff; color: #000; }
  .btn.ghost { background: rgba(255,255,255,0.14); color: #fff; border: 1px solid var(--stroke); }
  .msg { min-height: 1.3em; font-size: 0.9rem; margin: 2px 0 10px; text-align: center; color: var(--ink-2); }
  .tv-link { display: block; text-align: center; color: var(--ink-2); font-size: 0.9rem; margin-top: 14px; text-decoration: none; }

  /* TV: tutto in uno schermo */
  body.tv { height: 100vh; overflow: hidden; }
  body.tv .wrap { height: 100vh; max-width: none; padding: 2.2vh 2vw; gap: 1.8vh; }
  body.tv .main { flex: 1; min-height: 0; grid-template-rows: 1fr 1fr; }
  body.tv .chart { min-height: 0; }
  body.tv .tile { padding: 2.2vh 1.6vw 2vh; }

  @media (max-width: 1100px) {
    .tiles { grid-template-columns: 1fr 1fr; }
    .tile.hero, .tile:last-child { grid-column: 1 / -1; }
    .main { grid-template-columns: 1fr; }
    .side { grid-row: auto; grid-column: auto; order: -1; }
    .poster { max-height: none; }
    .clients-card { min-height: 160px; }
    .forms { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .wrap { padding: 12px 12px 30px; gap: 12px; }
    .bar { border-radius: 24px; padding: 10px 12px; flex-wrap: wrap; justify-content: center; }
    .brand span, .when .d { display: none; }
    .tiles { gap: 12px; }
    .tile { padding: 16px; border-radius: 24px; }
    .tile .big { font-size: 2rem; }
    .tile.hero .big { font-size: 2.8rem; }
    .tile .sub { font-size: 0.85rem; }
    .card { padding: 16px 14px 12px; border-radius: 24px; }
    .card-head { flex-direction: column; }
    .chart { min-height: 210px; }
    .form { padding: 18px; border-radius: 24px; }
  }
</style>
</head>
<body class="${tv ? "tv" : "pc"}">
<div class="bg"></div>
<div class="wrap" id="screen">
  <header class="bar glass">
    <div class="brand"><img src="/assets/img/logo.png" alt="Vendita Uno"><span>Dashboard</span></div>
    <div class="when"><span class="alert" id="alert">Foglio Google non raggiungibile</span><span class="d" id="date"></span><span class="clock num" id="clock"></span></div>
  </header>

  <section class="tiles">
    <div class="tile glass hero">
      <div class="label">Incassato oggi</div>
      <div class="big num" id="kToday">€ 0</div>
      <div class="sub" id="kTodaySub"></div>
    </div>
    <div class="tile glass">
      <div class="label" id="kMonthLabel">Incassato del mese</div>
      <div class="big num" id="kMonth">€ 0</div>
      <div class="sub" id="kMonthSub"></div>
    </div>
    <div class="tile glass">
      <div class="label">Lead arrivati oggi</div>
      <div class="big num" id="kLeads">0</div>
      <div class="sub" id="kLeadsSub"></div>
    </div>
    <div class="tile glass">
      <div class="label" id="kRoasLabel">Ritorno ads</div>
      <div class="big num" id="kRoas">n.d.</div>
      <div class="sub" id="kRoasSub"></div>
    </div>
  </section>

  <section class="main">
    <div class="card glass">
      <div class="card-head">
        <div><h2>Incassato giorno per giorno</h2><div class="meta" id="cashMeta"></div></div>
        <div class="monthnav"><button type="button" id="mPrev" aria-label="Mese precedente">‹</button><span class="lbl" id="mLabel"></span><button type="button" id="mNext" aria-label="Mese successivo">›</button></div>
      </div>
      <div class="chart" id="chCash"></div>
    </div>
    <div class="side">
      <div class="poster glass"><div class="img" role="img" aria-label="Napoleone attraversa le Alpi"></div><div class="cap"><div class="m">Conquistiamo</div><div class="s">Un cliente alla volta, una zona alla volta.</div></div></div>
      <div class="card glass clients-card">
        <div class="card-head"><div><h2>Clienti di oggi</h2><div class="meta" id="clMeta"></div></div></div>
        <div class="clients" id="clients"></div>
      </div>
    </div>
    <div class="card glass">
      <div class="card-head"><div><h2>Lead giorno per giorno</h2><div class="meta" id="leadMeta"></div></div></div>
      <div class="chart" id="chLeads"></div>
    </div>
  </section>

${tv ? "" : `  <section class="forms">
    <form class="form glass" id="clientForm">
      <h2>Nuovo cliente</h2>
      <p class="note">Ha pagato? Registralo qui: entra subito nell'incassato e compare sulla TV. Scrivi le prime lettere per i nomi dal foglio Google.</p>
      <div class="row">
        <div><label for="cname">Nome cliente</label><input id="cname" list="cnames" maxlength="80" placeholder="es. Mario Rossi" autocomplete="off"></div>
        <div><label for="camount">Incassato (€)</label><input id="camount" inputmode="decimal" placeholder="es. 1500" autocomplete="off"></div>
      </div>
      <datalist id="cnames"></datalist>
      <div class="msg" id="cmsg"></div>
      <button type="submit" class="btn">Registra cliente</button>
    </form>
    <form class="form glass" id="adsForm">
      <h2>Spesa ads</h2>
      <p class="note">I lead arrivano da soli dal foglio Google. La spesa ads per ora si scrive qui, giorno per giorno.</p>
      <div class="row">
        <div><label for="fdate">Giorno</label><input type="date" id="fdate"></div>
        <div><label for="fads">Spesa (€)</label><input id="fads" inputmode="decimal" placeholder="es. 300" autocomplete="off"></div>
      </div>
      <div class="msg" id="msg"></div>
      <button type="submit" class="btn ghost">Salva spesa</button>
      <a class="tv-link" href="${DASH_PATH}/tv" target="_blank">Apri la schermata della TV ↗</a>
    </form>
  </section>`}
</div>
<div class="toast glass" id="toast"><div class="k">Nuovo cliente</div><div class="n" id="toastName"></div><div class="a num" id="toastAmt"></div></div>

<script>
const API = '${DASH_PATH}/api';
const tvMode = document.body.classList.contains('tv');
const $ = (id) => document.getElementById(id);
const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// Punto delle migliaia sempre (Intl in italiano non lo mette sotto 10.000: "4000" vs "15.000").
function grp(n) {
  const s = String(Math.abs(Math.round(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) out += '.'; out += s[i]; }
  return (n < 0 && Math.round(n) !== 0 ? '-' : '') + out;
}
const nf0 = { format: grp };
function money(n) {
  const c = Math.round(Math.abs(n) * 100), cents = c % 100;
  return '€ ' + (n < 0 ? '-' : '') + grp(Math.floor(c / 100)) + (cents ? ',' + String(cents).padStart(2, '0') : '');
}
const money0 = (n) => '€ ' + grp(n);
const kfmt = (v) => v >= 1000 ? nf1.format(v / 1000).replace(',0', '') + 'k' : grp(v);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
let data = null, curMonth = null, lastClientsKey = null, seen = null, lastNames = '';
const anims = {};

function setNum(id, to, kind) {
  const el = $(id);
  if (!el) return;
  const prev = el.dataset.v;
  el.dataset.v = to;
  const fmt = (v, done) => kind === 'money' ? (done ? money(v) : money0(v)) : nf0.format(Math.round(v));
  const from = prev === undefined ? null : Number(prev);
  if (from === null || from === to) { el.textContent = fmt(to, true); return; }
  cancelAnimationFrame(anims[id]);
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 1200);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)), p === 1);
    if (p < 1) anims[id] = requestAnimationFrame(step);
  };
  anims[id] = requestAnimationFrame(step);
  if (to > from) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

// ---- Grafici (SVG disegnato alla misura reale del riquadro) ----
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function frame(box, series, key, axisFmt) {
  const W = box.clientWidth, H = box.clientHeight;
  const m = { l: 46, r: 8, t: 22, b: 24 };
  const pw = Math.max(10, W - m.l - m.r), ph = Math.max(10, H - m.t - m.b);
  const max = niceMax(Math.max.apply(null, series.map((s) => s[key] || 0)));
  const svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
  [0, 0.5, 1].forEach((f) => {
    const y = m.t + ph - ph * f;
    svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'grid' }));
    svg.appendChild(el('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'axis' }, axisFmt(max * f)));
  });
  const slot = pw / series.length;
  const ti = series.findIndex((s) => s.today);
  const every = W < 500 ? 10 : 5;
  series.forEach((s, i) => {
    const show = s.today || ((s.d === 1 || s.d % every === 0) && (ti < 0 || Math.abs(i - ti) * slot > 28));
    if (show) svg.appendChild(el('text', { x: m.l + slot * i + slot / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' + (s.today ? ' today' : '') }, s.today ? 'oggi' : s.d));
  });
  return { svg, W, H, m, pw, ph, max, slot, y: (v) => m.t + ph - (v / max) * ph, base: m.t + ph };
}
function tipAt(box, x, y, html) {
  let t = box.querySelector('.tip');
  if (!t) { t = document.createElement('div'); t.className = 'tip'; box.appendChild(t); }
  t.innerHTML = html;
  t.style.left = Math.max(60, Math.min(box.clientWidth - 60, x)) + 'px';
  t.style.top = Math.max(44, y) + 'px';
  t.classList.add('on');
}
function hideTip(box) { const t = box.querySelector('.tip'); if (t) t.classList.remove('on'); box.classList.remove('hovering'); }
function emptyMsg(box, text) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = text; box.appendChild(e); }

function drawCash(box, series) {
  box.replaceChildren();
  const past = series.filter((s) => !s.future);
  const f = frame(box, series, 'cashed', kfmt);
  const bw = Math.max(3, Math.min(30, f.slot * 0.62));
  const maxV = Math.max.apply(null, past.map((s) => s.cashed).concat([0]));
  const bars = [];
  series.forEach((s, i) => {
    if (s.future) return;
    const x = f.m.l + f.slot * i + (f.slot - bw) / 2, v = s.cashed;
    let bar = null;
    if (v > 0) {
      const y = f.y(v), h = f.base - y, r = Math.min(4, bw / 2, h);
      bar = el('path', { class: 'bar' + (s.today ? ' is-today' : ''), d: 'M' + x + ',' + f.base + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + f.base + 'Z' });
      f.svg.appendChild(bar);
      if (s.today || v === maxV) f.svg.appendChild(el('text', { x: x + bw / 2, y: y - 7, 'text-anchor': 'middle', class: 'val' }, kfmt(v)));
    }
    bars.push({ s, x: x + bw / 2, y: v > 0 ? f.y(v) : f.base, bar });
  });
  bars.forEach((b, i) => {
    const hit = el('rect', { class: 'hit', x: f.m.l + f.slot * i, y: f.m.t, width: f.slot, height: f.ph });
    const on = () => {
      box.classList.add('hovering');
      bars.forEach((o) => o.bar && o.bar.classList.toggle('hot', o === b));
      tipAt(box, b.x, b.y, '<span>' + esc(dayLabel(b.s.date)) + '</span><b>' + money(b.s.cashed) + '</b>');
    };
    hit.addEventListener('mouseenter', on);
    hit.addEventListener('click', on);
    hit.addEventListener('mouseleave', () => hideTip(box));
    f.svg.appendChild(hit);
  });
  f.svg.setAttribute('aria-label', 'Incassato giorno per giorno');
  box.appendChild(f.svg);
  if (!past.some((s) => s.cashed > 0)) emptyMsg(box, past.length ? 'Nessun incasso registrato in questo mese' : 'Mese non ancora iniziato');
}

function drawLeads(box, series) {
  box.replaceChildren();
  const past = series.filter((s) => !s.future);
  const f = frame(box, series, 'leads', (v) => nf0.format(v));
  if (!past.length) { box.appendChild(f.svg); emptyMsg(box, 'Mese non ancora iniziato'); return; }
  const pts = past.map((s, i) => [f.m.l + f.slot * i + f.slot / 2, f.y(s.leads || 0), s]);
  const defs = el('defs', {});
  const g = el('linearGradient', { id: 'gLead', x1: 0, x2: 0, y1: 0, y2: 1 });
  g.appendChild(el('stop', { offset: '0%', 'stop-color': '#2a86c8', 'stop-opacity': 0.45 }));
  g.appendChild(el('stop', { offset: '100%', 'stop-color': '#2a86c8', 'stop-opacity': 0 }));
  defs.appendChild(g); f.svg.appendChild(defs);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join('');
  f.svg.appendChild(el('path', { d: line + 'L' + pts[pts.length - 1][0] + ',' + f.base + 'L' + pts[0][0] + ',' + f.base + 'Z', fill: 'url(#gLead)' }));
  f.svg.appendChild(el('path', { d: line, class: 'line' }));
  const last = pts[pts.length - 1];
  f.svg.appendChild(el('circle', { cx: last[0], cy: last[1], r: 5, class: 'mk' }));
  f.svg.appendChild(el('text', { x: last[0], y: last[1] - 11, 'text-anchor': 'middle', class: 'val' }, nf0.format(last[2].leads)));
  const cross = el('line', { class: 'cross', y1: f.m.t, y2: f.base, x1: 0, x2: 0, visibility: 'hidden' });
  const dot = el('circle', { r: 5, class: 'mk', cx: 0, cy: 0, visibility: 'hidden' });
  f.svg.appendChild(cross); f.svg.appendChild(dot);
  const hit = el('rect', { class: 'hit', x: f.m.l, y: f.m.t, width: f.pw, height: f.ph });
  const move = (ev) => {
    const r = box.getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.floor((ev.clientX - r.left - f.m.l) / f.slot)));
    const p = pts[i];
    cross.setAttribute('x1', p[0]); cross.setAttribute('x2', p[0]); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('visibility', 'visible');
    tipAt(box, p[0], p[1], '<span>' + esc(dayLabel(p[2].date)) + '</span><b>' + nf0.format(p[2].leads) + ' lead</b>');
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('click', move);
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(box); });
  f.svg.appendChild(hit);
  f.svg.setAttribute('aria-label', 'Lead giorno per giorno');
  box.appendChild(f.svg);
}

function drawCharts() { if (!data) return; drawCash($('chCash'), data.series); drawLeads($('chLeads'), data.series); }
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawCharts, 120); });

// ---- Annuncio nuovo cliente ----
let toastT;
function announce(c) {
  $('toastName').textContent = c.name;
  $('toastAmt').textContent = '+ ' + money(c.amount);
  $('toast').classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('on'), 4500);
}

function render(d) {
  const firstLoad = data === null;
  data = d; curMonth = d.month.ym;
  const t = d.todayData, mo = d.month, monthName = mo.label.split(' ')[0];
  $('date').textContent = cap(new Date(d.today + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }));
  $('alert').classList.toggle('on', !d.sheetOk);

  // Incassato oggi
  setNum('kToday', t.cashed, 'money');
  const nC = t.clients.length, diff = round(t.cashed - d.yesterday.cashed);
  $('kTodaySub').innerHTML = '<span>' + (nC ? '<b>' + nC + '</b> ' + (nC === 1 ? 'cliente' : 'clienti') : 'Nessun cliente ancora') + '</span>' +
    '<span class="' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '') + '">' + (diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : '') + money0(Math.abs(diff)) + ' vs ieri</span>';

  // Incassato del mese + proiezione
  $('kMonthLabel').textContent = 'Incassato ' + monthName;
  setNum('kMonth', mo.cashed, 'money');
  $('kMonthSub').innerHTML = (mo.clients ? '<span><b>' + mo.clients + '</b> ' + (mo.clients === 1 ? 'cliente' : 'clienti') + '</span>' : '') +
    (mo.projection != null ? '<span>Proiezione <b>' + money0(mo.projection) + '</b></span>' : mo.projectionNote ? '<span>' + esc(mo.projectionNote) + '</span>' : mo.isFuture ? '' : '<span>Mese chiuso</span>');

  // Lead
  setNum('kLeads', t.leads, 'int');
  const dl = t.leads - d.yesterday.leads;
  $('kLeadsSub').innerHTML = '<span class="pill' + (t.toCall ? '' : ' ok') + '"><span class="dot"></span>' + nf0.format(t.toCall || 0) + ' da chiamare</span>' +
    '<span class="' + (dl > 0 ? 'up' : dl < 0 ? 'down' : '') + '">' + (dl > 0 ? '▲ ' : dl < 0 ? '▼ ' : '') + Math.abs(dl) + ' vs ieri</span>';

  // Ritorno sulla spesa ads del mese
  $('kRoasLabel').textContent = 'Ritorno ads ' + monthName;
  $('kRoas').textContent = mo.roas != null ? 'x' + nf1.format(mo.roas) : 'n.d.';
  $('kRoasSub').innerHTML = mo.adsSpend > 0
    ? '<span><b>' + money0(mo.adsSpend) + '</b> spesi</span>' + (mo.cpl != null ? '<span>CPL <b>' + money0(mo.cpl) + '</b></span>' : '') + (mo.cac != null ? '<span>CAC <b>' + money0(mo.cac) + '</b></span>' : '')
    : '<span>Inserisci la spesa ads per vedere CPL e CAC</span>';

  // Grafici
  $('mLabel').textContent = mo.label;
  $('mNext').disabled = mo.isCurrent || mo.isFuture;
  const bestDay = d.series.filter((s) => !s.future).reduce((b, s) => (s.cashed > (b ? b.cashed : 0) ? s : b), null);
  $('cashMeta').textContent = money0(mo.cashed) + ' nel mese' + (bestDay ? ' · giorno migliore ' + dayLabel(bestDay.date) : '');
  $('leadMeta').textContent = nf0.format(mo.leads) + ' lead nel mese' + (mo.elapsed ? ' · media ' + nf1.format(mo.leads / mo.elapsed) + ' al giorno' : '');
  drawCharts();

  // Clienti di oggi
  const list = t.clients.slice().reverse();
  const key = list.map((c) => c.id).join(',');
  if (key !== lastClientsKey) {
    lastClientsKey = key;
    const fresh = seen ? list.filter((c) => !seen.has(c.id)) : [];
    $('clMeta').textContent = nC ? money0(t.cashed) + ' da ' + nC + (nC === 1 ? ' cliente' : ' clienti') : '';
    $('clients').innerHTML = list.length ? list.map((c) =>
      '<div class="cl' + (fresh.indexOf(c) >= 0 ? ' new' : '') + '"><div class="av">' + esc((c.name.trim()[0] || '?').toUpperCase()) + '</div>' +
      '<div class="who"><div class="name">' + esc(c.name) + '</div><div class="time">' + new Date(c.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + '</div></div>' +
      '<div class="amt num">' + money(c.amount) + '</div>' +
      (tvMode ? '' : '<button type="button" class="del" data-id="' + esc(c.id) + '">Elimina</button>') + '</div>'
    ).join('') : '<div class="none">Ancora nessun cliente oggi.</div>';
    if (fresh.length && !firstLoad) announce(fresh[0]);
    seen = new Set(list.map((c) => c.id));
  }

  if ($('cnames') && d.names && d.names.join('|') !== lastNames) {
    lastNames = d.names.join('|');
    $('cnames').innerHTML = d.names.map((n) => '<option value="' + esc(n) + '">').join('');
  }
  if ($('fdate') && !$('fdate').value) {
    $('fdate').value = d.today; $('fdate').max = d.today;
    $('fads').value = t.adsSpend || '';
  }
}
function round(n) { return Math.round(n * 100) / 100; }

async function refresh(ym) {
  try {
    const r = await fetch(API + (ym ? '?month=' + ym : ''), { cache: 'no-store' });
    if (r.status === 401) { location.reload(); return; }
    render(await r.json());
  } catch (e) { $('alert').textContent = 'Connessione persa, riprovo'; $('alert').classList.add('on'); }
}
function shift(ym, n) { const p = ym.split('-').map(Number); const t = p[0] * 12 + p[1] - 1 + n; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); }

function tick() { $('clock').textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
tick(); setInterval(tick, 1000);
refresh(); setInterval(() => refresh(curMonth), 6000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(curMonth); });
async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch (e) {} }
keepAwake(); document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
$('screen').addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
$('mPrev').onclick = () => refresh(shift(curMonth, -1));
$('mNext').onclick = () => { if (!$('mNext').disabled) refresh(shift(curMonth, 1)); };

if ($('clientForm')) {
  const parseAmount = (s) => {
    s = String(s || '').split('€').join('').split(' ').join('').trim();
    if (!s) return 0;
    if (s.indexOf(',') >= 0) s = s.split('.').join('').replace(',', '.');
    else if (/^[0-9]{1,3}([.][0-9]{3})+$/.test(s)) s = s.split('.').join('');
    return Number(s);
  };
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error();
    return r.json();
  };

  $('clientForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('cname').value.trim(), amount = parseAmount($('camount').value);
    if (!name) { $('cmsg').textContent = 'Scrivi il nome del cliente'; return; }
    if (!isFinite(amount) || amount <= 0) { $('cmsg').textContent = 'Importo non valido'; return; }
    $('cmsg').textContent = 'Salvo…';
    try {
      render(await post(API + '/client', { date: data.today, name, amount }));
      $('cname').value = ''; $('camount').value = '';
      $('cmsg').textContent = '✓ ' + name + ' registrato';
    } catch (err) { $('cmsg').textContent = 'Errore, riprova'; }
  };

  $('fdate').onchange = async () => {
    const date = $('fdate').value;
    try {
      const r = await fetch(API + '?month=' + date.slice(0, 7), { cache: 'no-store' });
      const d = await r.json();
      $('fads').value = (d.days[date] && d.days[date].adsSpend) || '';
    } catch (e) {}
  };

  $('adsForm').onsubmit = async (e) => {
    e.preventDefault();
    const adsSpend = parseAmount($('fads').value);
    if (!isFinite(adsSpend) || adsSpend < 0) { $('msg').textContent = 'Importo non valido'; return; }
    $('msg').textContent = 'Salvo…';
    try {
      render(await post(API, { date: $('fdate').value, adsSpend }));
      $('msg').textContent = '✓ Spesa salvata';
    } catch (err) { $('msg').textContent = 'Errore, riprova'; }
  };

  // Primo clic: "Sicuro?" · secondo clic: elimina
  $('clients').onclick = async (e) => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    if (!btn.classList.contains('sure')) {
      btn.classList.add('sure'); btn.textContent = 'Sicuro?';
      setTimeout(() => { if (btn.isConnected && btn.textContent === 'Sicuro?') { btn.classList.remove('sure'); btn.textContent = 'Elimina'; } }, 4000);
      return;
    }
    btn.disabled = true; btn.textContent = 'Elimino…';
    try {
      const r = await fetch(API + '/client?date=' + encodeURIComponent(data.today) + '&id=' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
      if (!r.ok) throw new Error();
      render(await r.json());
    } catch (err) { btn.disabled = false; btn.classList.remove('sure'); btn.textContent = 'Elimina'; }
  };
}
</script>
</body>
</html>`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleDashboard(request, env, url) {
  const kv = env.ACADEMY_PROGRESS;
  if (!kv) return new Response("KV not configured", { status: 500 });
  const path = url.pathname.replace(/\/+$/, "");

  // Il cookie vale solo sotto /dashboardvenditatop: la scorciatoia /tv porta lì.
  if (path === TV_PATH) return new Response(null, { status: 302, headers: { Location: `${DASH_PATH}/tv` } });

  if (path === `${DASH_PATH}/login` && request.method === "POST") {
    const form = await request.formData();
    const ok = await checkDashPassword((form.get("password") || "").toString());
    const tv = !!url.searchParams.get("tv");
    if (!ok) return html(loginPage("Password non corretta.", tv));
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await kv.put(`dashsess:${token}`, "1", { expirationTtl: DASH_SESSION_DAYS * 86400 });
    return new Response(null, {
      status: 302,
      headers: {
        Location: tv ? `${DASH_PATH}/tv` : DASH_PATH,
        "Set-Cookie": `${DASH_COOKIE}=${token}; Path=${DASH_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${DASH_SESSION_DAYS * 86400}`,
      },
    });
  }

  const loggedIn = await isLoggedIn(request, kv);

  if (path === `${DASH_PATH}/api`) {
    if (!loggedIn) return json({ error: "unauthorized" }, 401);
    const today = romeDate();

    if (request.method === "GET") {
      const ym = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : today.slice(0, 7);
      return json(await payload(kv, ym, today));
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const date = DATE_RE.test(body.date || "") ? body.date : today;
      if (date > today) return json({ error: "data non valida" }, 400);
      const adsSpend = round2(Number(body.adsSpend) || 0);
      if (!isFinite(adsSpend) || adsSpend < 0 || adsSpend > 100000000) return json({ error: "valore non valido" }, 400);
      const day = (await readDay(kv, date)) || EMPTY_DAY;
      await kv.put(`fatturato:${date}`, JSON.stringify({ ...day, adsSpend }));
      return json(await payload(kv, date.slice(0, 7), today));
    }

    return new Response("Method not allowed", { status: 405 });
  }

  if (path === `${DASH_PATH}/api/client`) {
    if (!loggedIn) return json({ error: "unauthorized" }, 401);
    const today = romeDate();

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const date = DATE_RE.test(body.date || "") ? body.date : today;
      if (date > today) return json({ error: "data non valida" }, 400);
      const name = String(body.name || "").trim().slice(0, 80);
      const amount = round2(Number(body.amount) || 0);
      if (!name) return json({ error: "nome del cliente mancante" }, 400);
      if (!isFinite(amount) || amount <= 0 || amount > 100000000) return json({ error: "importo non valido" }, 400);
      const day = (await readDay(kv, date)) || EMPTY_DAY;
      const clients = [...day.clients, { id: toHex(crypto.getRandomValues(new Uint8Array(6))), name, amount, ts: Date.now() }];
      await kv.put(`fatturato:${date}`, JSON.stringify({ ...day, clients }));
      return json(await payload(kv, date.slice(0, 7), today));
    }

    if (request.method === "DELETE") {
      const date = DATE_RE.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : today;
      const id = url.searchParams.get("id") || "";
      const day = (await readDay(kv, date)) || EMPTY_DAY;
      const clients = day.clients.filter((c) => c.id !== id);
      await kv.put(`fatturato:${date}`, JSON.stringify({ ...day, clients }));
      return json(await payload(kv, date.slice(0, 7), today));
    }

    return new Response("Method not allowed", { status: 405 });
  }

  if (path === DASH_PATH || path === `${DASH_PATH}/login`) {
    return html(loggedIn ? dashboardPage(false) : loginPage(null));
  }

  if (path === `${DASH_PATH}/tv`) {
    return html(loggedIn ? dashboardPage(true) : loginPage(null, true));
  }

  return new Response(null, { status: 302, headers: { Location: DASH_PATH } });
}
