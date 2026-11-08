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
    fetchCsv(sheetUrl("APPUNTAMENTI FISSATI", "select A, D, G, H, I", 1)),
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
  // Demo fissate: NOME (A), CITTÀ (D), VENDITORE (G), ESITO (H), FISSATO IL (I, "05/11/2026 13:15").
  const demos = [];
  for (const [name, city, seller, outcome, at] of appRows) {
    const n = (name || "").trim();
    if (!n || n.toUpperCase() === "NOME") continue;
    const when = parseWhen(at);
    demos.push({
      name: n.slice(0, 80),
      city: titleCase((city || "").trim()).slice(0, 40),
      seller: titleCase((seller || "").trim().replace(/^venditore\s+/i, "")).slice(0, 30),
      outcome: (outcome || "").trim().slice(0, 30),
      date: when ? when.date : "",
      time: when ? when.time : "",
    });
  }
  demos.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const toCallCell = kpiRows.map((r) => (r[0] || "").trim()).find((v) => v !== "" && isFinite(Number(v.replace(",", "."))));
  return {
    leadsByDay,
    toCall: toCallCell !== undefined ? Number(toCallCell.replace(",", ".")) : null,
    names: [...new Set([...demos.map((d) => d.name), ...leadNames])].slice(0, 400),
    demos,
  };
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

// Date del foglio: "05/11/2026 13:15" (giorno/mese/anno) oppure ISO.
function parseWhen(raw) {
  const s = (raw || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return { date: `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`, time: m[4] ? `${pad2(m[4])}:${m[5]}` : "" };
  const t = new Date(s);
  if (!s || isNaN(t)) return null;
  const time = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" }).format(t);
  return { date: ROME_DAY.format(t), time };
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
    demos: sheet ? {
      today: sheet.demos.filter((x) => x.date === today).length,
      month: sheet.demos.filter((x) => x.date.startsWith(todayYm)).length,
      list: sheet.demos.slice(0, 12),
    } : null,
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
<meta name="theme-color" content="#12161c">
<link rel="icon" type="image/png" href="/assets/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">`;

// Palette presa dal quadro: cielo in tempesta (ardesia), mantello (cremisi), galloni (oro), cavallo (avorio).
const GLASS_CSS = `
  :root {
    --slate-1: #1a2029;
    --slate-2: #0f1318;
    --crimson: #9e2a22;
    --gold: #b98318;
    --bone: #ece6da;
    --bone-2: rgba(236,230,218,0.70);
    --bone-3: rgba(236,230,218,0.48);
    --hair: rgba(236,230,218,0.10);
    --good: #6fdc9a;
    --bad: #ff8a80;
    --sans: "Geist", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    --serif: "Instrument Serif", "Iowan Old Style", Georgia, serif;
    --r-xl: 30px;
    --r-lg: 22px;
    --r-md: 14px;
  }
  * { box-sizing: border-box; }
  html {
    overflow-x: clip;
    background:
      radial-gradient(760px 560px at 86% 220px, rgba(158,42,34,0.30), rgba(158,42,34,0) 70%),
      radial-gradient(50% 40% at 8% 105%, rgba(185,131,24,0.10), rgba(185,131,24,0) 70%),
      linear-gradient(165deg, var(--slate-1) 0%, #151a21 45%, var(--slate-2) 100%);
    background-color: var(--slate-2);
    min-height: 100%;
  }
  body { margin: 0; color: var(--bone); font-family: var(--sans); font-size: 15px; line-height: 1.45; -webkit-font-smoothing: antialiased; background: transparent; }
  .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "ss01" 1; }

  /* Napoleone: attaccato al bordo destro, sfuma a sinistra e in basso nel gradiente della pagina */
  .napo { position: absolute; top: 0; right: 0; height: 60vh; width: calc(60vh * 582 / 343); z-index: -1; pointer-events: none;
    background: url(/assets/img/napoleone.jpg) center / cover no-repeat;
    filter: saturate(1.06) contrast(1.05) brightness(0.96);
    -webkit-mask-image: linear-gradient(90deg, transparent 8%, rgba(0,0,0,0.5) 30%, #000 52%), linear-gradient(180deg, #000 48%, rgba(0,0,0,0.62) 68%, rgba(0,0,0,0.22) 86%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-image: linear-gradient(90deg, transparent 8%, rgba(0,0,0,0.5) 30%, #000 52%), linear-gradient(180deg, #000 48%, rgba(0,0,0,0.62) 68%, rgba(0,0,0,0.22) 86%, transparent 100%);
    mask-composite: intersect; }
  .grain { position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.06; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }

  /* Vetro: base quasi trasparente, bordo che si accende negli angoli, riflesso in alto, ombra doppia */
  .glass { position: relative; isolation: isolate; border-radius: var(--r-xl);
    background: linear-gradient(180deg, rgba(255,255,255,0.085) 0%, rgba(255,255,255,0.035) 38%, rgba(255,255,255,0.02) 100%), rgba(17,21,27,0.38);
    -webkit-backdrop-filter: blur(32px) saturate(1.6);
    backdrop-filter: blur(32px) saturate(1.6);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.16),
      inset 0 22px 34px -26px rgba(255,255,255,0.20),
      inset 0 -18px 30px -28px rgba(0,0,0,0.45),
      0 1px 1px rgba(0,0,0,0.18),
      0 10px 22px -12px rgba(0,0,0,0.40),
      0 34px 70px -34px rgba(0,0,0,0.65); }
  .glass::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; z-index: 2;
    background: linear-gradient(140deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.16) 16%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0.03) 62%, rgba(255,255,255,0.14) 84%, rgba(255,255,255,0.42) 100%);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
  .glass::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1;
    background: radial-gradient(120% 80% at 10% -30%, rgba(255,255,255,0.13), rgba(255,255,255,0) 52%), radial-gradient(90% 70% at 100% 130%, rgba(255,255,255,0.05), rgba(255,255,255,0) 60%); }
  .well { background: rgba(0,0,0,0.16); border-radius: var(--r-md); box-shadow: inset 0 1px 1px rgba(0,0,0,0.25), inset 0 -1px 0 rgba(255,255,255,0.06); }
`;

function loginPage(error, tv = false) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Accedi alla dashboard</title>
<style>
${GLASS_CSS}
  body { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
  .napo { height: 82vh; width: calc(82vh * 582 / 343); }
  form { width: 100%; max-width: 380px; padding: 34px 28px 28px; text-align: center; }
  @media (min-width: 900px) { body { place-items: center start; padding-left: 9vw; } }
  img.logo { height: 30px; margin: 0 auto 22px; display: block; }
  h1 { font-family: var(--serif); font-weight: 400; font-size: 2.6rem; line-height: 1; letter-spacing: -0.01em; margin: 0 0 24px; }
  input { width: 100%; padding: 15px 16px; font: inherit; font-size: 1.05rem; color: var(--bone); border: 0; margin-bottom: 14px; text-align: center; outline: none; }
  input:focus-visible { box-shadow: inset 0 1px 1px rgba(0,0,0,0.25), 0 0 0 2px rgba(236,230,218,0.5); }
  button { width: 100%; padding: 15px; font: inherit; font-size: 1rem; font-weight: 600; background: var(--bone); color: #14181e; border: 0; border-radius: 999px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--bone); outline-offset: 3px; }
  .err { color: var(--bad); margin: -8px 0 16px; }
</style>
</head>
<body>
<div class="napo" aria-hidden="true"></div><div class="grain"></div>
<form class="glass" method="POST" action="${DASH_PATH}/login${tv ? "?tv=1" : ""}">
  <img class="logo" src="/assets/img/logo.png" alt="Vendita Uno">
  <h1>Conquistiamo.</h1>
  ${error ? `<p class="err">${error}</p>` : ""}
  <input class="well" type="password" name="password" placeholder="Password" required autofocus autocomplete="current-password" aria-label="Password">
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
<title>${tv ? "Vendita Uno in TV" : "Dashboard Vendita Uno"}</title>
<style>
${GLASS_CSS}
  :root { --pad: clamp(14px, 2vw, 40px); --gap: clamp(12px, 1.15vw, 22px); }
  .layout { display: grid; gap: var(--gap); padding: var(--pad); max-width: 1680px; margin: 0 auto;
    grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr);
    grid-template-areas: "top top" "tiles hole" "chart side" "demos side" "forms forms"; }
  .top { grid-area: top; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; }
  .tiles { grid-area: tiles; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gap); }
  .hole { grid-area: hole; position: relative; display: flex; align-items: flex-end; padding: 0 0 6px 6px; min-height: 240px; }
  .chart-card { grid-area: chart; }
  .demos-card { grid-area: demos; }
  .side { grid-area: side; min-width: 0; }
  .forms { grid-area: forms; }

  /* Testata */
  .top img { height: 28px; display: block; }
  .when { display: flex; align-items: center; gap: 14px; padding: 7px 8px 7px 18px; border-radius: 999px; }
  .when .d { font-family: var(--serif); font-size: 1.35rem; line-height: 1; }
  .when .clock { font-weight: 600; font-size: 1rem; padding: 7px 13px; border-radius: 999px; }
  .alert { display: none; color: #fff; background: rgba(255,90,80,0.22); box-shadow: inset 0 0 0 1px rgba(255,138,128,0.55); border-radius: 999px; padding: 7px 13px; font-size: 0.85rem; font-weight: 600; }
  .alert.on { display: inline-flex; }

  /* Il buco su Napoleone */
  .motto { font-family: var(--serif); font-style: italic; font-size: clamp(2.6rem, 3.7vw, 4.6rem); line-height: 0.95; letter-spacing: -0.01em; color: var(--bone);
    text-shadow: 0 2px 4px rgba(0,0,0,0.35), 0 10px 40px rgba(0,0,0,0.65); }

  /* Tessere */
  .tile { padding: 20px 22px 18px; display: flex; flex-direction: column; min-width: 0; }
  .tile h3, .card h2 { margin: 0; font-size: 0.95rem; font-weight: 500; color: var(--bone-2); letter-spacing: 0; }
  .tile .big { font-size: clamp(2rem, 2.65vw, 3.3rem); font-weight: 600; letter-spacing: -0.035em; line-height: 1; margin: 14px 0 14px; white-space: nowrap; }
  .tile .sub { margin-top: auto; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; color: var(--bone-2); font-size: 0.9rem; }
  .tile .sub b { color: var(--bone); font-weight: 600; }
  .hero { grid-column: 1 / -1; flex-direction: row; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 22px 26px 22px; border-radius: 34px; }
  .hero .big { font-size: clamp(3.2rem, 5.6vw, 7rem); letter-spacing: -0.045em; margin: 10px 0 0; }
  .hero .side-stats { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; padding-bottom: 6px; text-align: right; }
  .stat { font-size: 1rem; color: var(--bone-2); }
  .stat b { color: var(--bone); font-weight: 600; font-size: 1.25rem; }
  .up { color: var(--good); }
  .down { color: var(--bad); }
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; border-radius: 999px; font-weight: 600; color: var(--bone); background: rgba(255,255,255,0.07); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); }
  .chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--bad); box-shadow: 0 0 0 3px rgba(255,138,128,0.18); }
  .chip.ok i { background: var(--good); box-shadow: 0 0 0 3px rgba(111,220,154,0.18); }

  /* Schede grandi */
  .card { padding: 20px 22px 18px; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 12px; }
  .card h2 { color: var(--bone); font-size: 1.05rem; font-weight: 600; }
  .card .meta { color: var(--bone-3); font-size: 0.88rem; margin-top: 3px; }
  .counts { display: flex; gap: 8px; flex: none; }
  .count { padding: 6px 12px; border-radius: 999px; font-size: 0.88rem; color: var(--bone-2); background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10); }
  .count b { color: var(--bone); font-weight: 600; }

  .monthnav { display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 999px; flex: none; }
  .monthnav button { width: 32px; height: 32px; border-radius: 50%; border: 0; background: transparent; color: var(--bone); font-size: 1.15rem; cursor: pointer; display: grid; place-items: center; }
  .monthnav button:hover:not(:disabled) { background: rgba(255,255,255,0.10); }
  .monthnav button:focus-visible { outline: 2px solid var(--bone); outline-offset: 1px; }
  .monthnav button:disabled { opacity: 0.28; cursor: default; }
  .monthnav .lbl { font-weight: 600; min-width: 8.5em; text-align: center; font-size: 0.92rem; }

  .chart { position: relative; flex: 1; min-height: 240px; }
  .chart svg { display: block; overflow: visible; }
  .chart .grid { stroke: rgba(236,230,218,0.09); stroke-width: 1; }
  .chart .axis { fill: var(--bone-3); font-size: 11px; font-family: var(--sans); }
  .chart .axis.today { fill: var(--bone); font-weight: 600; }
  .chart .val { fill: var(--bone); font-size: 12px; font-weight: 600; font-family: var(--sans); }
  .chart .bar { fill: var(--gold); transition: opacity .15s; }
  .chart .bar.is-today { fill: #cf9726; }
  .chart.hovering .bar { opacity: 0.4; }
  .chart.hovering .bar.hot { opacity: 1; }
  .chart .hit { fill: transparent; }
  .chart .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--bone-3); text-align: center; padding: 0 20px; }
  .tip { position: absolute; pointer-events: none; transform: translate(-50%, calc(-100% - 12px)); padding: 8px 12px; border-radius: var(--r-md); font-size: 0.85rem; white-space: nowrap; opacity: 0; transition: opacity .12s;
    background: rgba(24,28,36,0.72); -webkit-backdrop-filter: blur(16px) saturate(1.6); backdrop-filter: blur(16px) saturate(1.6); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 10px 24px -10px rgba(0,0,0,0.6); }
  .tip.on { opacity: 1; }
  .tip b { display: block; font-size: 1rem; font-weight: 600; }
  .tip span { color: var(--bone-3); }

  /* Tabella demo fissate */
  .table { display: flex; flex-direction: column; min-height: 0; overflow: hidden; flex: 1; }
  .tr { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 7.5rem; gap: 14px; align-items: center; padding: 10px 14px; }
  .thead { color: var(--bone-3); font-size: 0.82rem; padding-top: 0; padding-bottom: 8px; }
  .thead span:last-child { text-align: right; }
  .tbody { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; min-height: 0; }
  .tbody .tr { border-radius: var(--r-md); }
  .tbody .tr:nth-child(odd) { background: rgba(255,255,255,0.035); }
  .tr .n { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tr .c, .tr .v, .tr .w { color: var(--bone-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tr .w.today { color: var(--bone); font-weight: 600; }
  .esito { justify-self: end; display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px 4px 9px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10); white-space: nowrap; }
  .esito i { width: 7px; height: 7px; border-radius: 50%; background: var(--bone-3); }
  .esito.good i { background: var(--good); }
  .esito.bad i { background: var(--bad); }
  .table .none { color: var(--bone-3); padding: 18px 14px; }

  /* Clienti di oggi */
  .side { display: flex; flex-direction: column; }
  .clients { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; flex: 1; }
  .cl { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--r-lg); background: rgba(255,255,255,0.045); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
  .cl .av { width: 38px; height: 38px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #241a06;
    background: radial-gradient(120% 120% at 30% 20%, #f3d58c, #b98318 70%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); }
  .cl .who { flex: 1; min-width: 0; }
  .cl .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cl .time { color: var(--bone-3); font-size: 0.8rem; }
  .cl .amt { font-weight: 600; font-size: 1.05rem; }
  .cl .del { background: none; border: 0; box-shadow: inset 0 0 0 1px rgba(255,138,128,0.45); color: var(--bad); cursor: pointer; font: inherit; font-size: 0.78rem; font-weight: 600; padding: 5px 10px; border-radius: 999px; flex: none; }
  .cl .del.sure { background: #d9443b; box-shadow: none; color: #fff; }
  .cl.new { animation: newcl 1.6s ease-out; }
  @keyframes newcl { 0% { box-shadow: inset 0 0 0 1px rgba(243,213,140,0.9), 0 0 30px rgba(243,213,140,0.35); } 100% { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); } }
  .clients .none { color: var(--bone-3); padding: 14px 4px; }

  /* Annuncio nuovo cliente: l'unico momento animato */
  .toast { position: fixed; left: 50%; top: 44%; z-index: 20; transform: translate(-50%, -50%) scale(0.94); opacity: 0; pointer-events: none; text-align: center; padding: 28px 48px 30px; border-radius: 40px; transition: opacity .45s, transform .45s cubic-bezier(.2,.9,.3,1.2); }
  .toast.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  .toast .k { font-family: var(--serif); font-style: italic; font-size: clamp(1.4rem, 2.2vw, 2.2rem); color: var(--bone-2); }
  .toast .n { font-size: clamp(2rem, 4.4vw, 4.4rem); font-weight: 600; letter-spacing: -0.035em; margin-top: 4px; }
  .toast .a { font-size: clamp(1.6rem, 3.2vw, 3.2rem); font-weight: 600; color: var(--good); letter-spacing: -0.02em; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: opacity .2s; } .cl.new { animation: none; } }

  /* Moduli (solo PC) */
  .forms { display: grid; grid-template-columns: 1.3fr 1fr; gap: var(--gap); }
  .form { padding: 24px; }
  .form h2 { margin: 0 0 4px; font-size: 1.1rem; font-weight: 600; }
  .form .note { color: var(--bone-3); font-size: 0.88rem; margin: 0 0 18px; max-width: 60ch; }
  .form label { display: block; font-size: 0.85rem; color: var(--bone-2); margin: 0 0 6px 4px; }
  .form input { width: 100%; padding: 14px 16px; font: inherit; font-size: 1.05rem; color: var(--bone); border: 0; margin-bottom: 14px; outline: none; color-scheme: dark; }
  .form input:focus-visible { box-shadow: inset 0 1px 1px rgba(0,0,0,0.25), 0 0 0 2px rgba(236,230,218,0.5); }
  .form .row { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; }
  .btn { width: 100%; padding: 14px; font: inherit; font-size: 1rem; font-weight: 600; border-radius: 999px; cursor: pointer; border: 0; background: var(--bone); color: #14181e; }
  .btn.ghost { background: rgba(255,255,255,0.10); color: var(--bone); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16); }
  .btn:focus-visible { outline: 2px solid var(--bone); outline-offset: 3px; }
  .msg { min-height: 1.3em; font-size: 0.9rem; margin: 0 0 10px; text-align: center; color: var(--bone-2); }
  .tv-link { display: block; text-align: center; color: var(--bone-2); font-size: 0.9rem; margin-top: 14px; }

  /* TV: tutto in uno schermo */
  body.tv { height: 100vh; overflow: hidden; }
  body.tv .layout { height: 100vh; max-width: none; grid-template-rows: auto auto minmax(0, 1fr) minmax(0, 1.1fr); grid-template-areas: "top top" "tiles hole" "chart side" "demos side"; }
  body.tv .chart { min-height: 0; }

  @media (max-width: 1180px) {
    .layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: "top" "hole" "tiles" "side" "chart" "demos" "forms"; }
    .hole { min-height: 300px; }
    .side .clients { max-height: 420px; }
    .forms { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    body { font-size: 14px; }
    .when .d { display: none; }
    .when { padding: 5px 5px 5px 5px; }
    .hole { min-height: 230px; }
    .tiles { grid-template-columns: 1fr 1fr; }
    .tiles .tile:last-child { grid-column: 1 / -1; }
    .hero { flex-direction: column; align-items: flex-start; gap: 12px; border-radius: 28px; }
    .hero .side-stats { flex-direction: row; flex-wrap: wrap; gap: 6px 16px; align-items: center; text-align: left; padding: 0; }
    .tile { padding: 16px 16px 14px; border-radius: 24px; }
    .tile .big { font-size: 1.9rem; }
    .hero .big { font-size: 3rem; }
    .card { padding: 16px 14px 14px; border-radius: 24px; }
    .card-head { flex-wrap: wrap; }
    .chart { min-height: 210px; }
    .tr { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "n e" "w e"; gap: 2px 10px; padding: 10px 12px; }
    .tr .n { grid-area: n; } .tr .w { grid-area: w; font-size: 0.82rem; } .tr .esito { grid-area: e; }
    .tr .c, .tr .v, .thead { display: none; }
    .form { padding: 18px; border-radius: 24px; }
    .form .row { grid-template-columns: 1fr; gap: 0; }
  }
</style>
</head>
<body class="${tv ? "tv" : "pc"}">
<div class="napo" id="napo" aria-hidden="true"></div>
<div class="grain"></div>
<div class="layout" id="screen">
  <header class="top">
    <img src="/assets/img/logo.png" alt="Vendita Uno">
    <div class="when glass"><span class="alert" id="alert">Foglio Google non raggiungibile</span><span class="d" id="date"></span><span class="clock num well" id="clock"></span></div>
  </header>

  <section class="tiles" aria-label="Numeri principali">
    <div class="tile glass hero">
      <div>
        <h3>Incassato oggi</h3>
        <div class="big num" id="kToday">€ 0</div>
      </div>
      <div class="side-stats" id="kTodaySub"></div>
    </div>
    <div class="tile glass">
      <h3 id="kMonthLabel">Incassato del mese</h3>
      <div class="big num" id="kMonth">€ 0</div>
      <div class="sub" id="kMonthSub"></div>
    </div>
    <div class="tile glass">
      <h3>Lead arrivati oggi</h3>
      <div class="big num" id="kLeads">0</div>
      <div class="sub" id="kLeadsSub"></div>
    </div>
    <div class="tile glass">
      <h3 id="kRoasLabel">Ritorno sulle ads</h3>
      <div class="big num" id="kRoas">n.d.</div>
      <div class="sub" id="kRoasSub"></div>
    </div>
  </section>

  <div class="hole" id="hole"><div class="motto">Conquistiamo.</div></div>

  <section class="card glass chart-card">
    <div class="card-head">
      <div><h2>Incassato giorno per giorno</h2><div class="meta" id="cashMeta"></div></div>
      <div class="monthnav well"><button type="button" id="mPrev" aria-label="Mese precedente">‹</button><span class="lbl" id="mLabel"></span><button type="button" id="mNext" aria-label="Mese successivo">›</button></div>
    </div>
    <div class="chart" id="chCash"></div>
  </section>

  <section class="card glass demos-card">
    <div class="card-head">
      <div><h2>Demo fissate</h2><div class="meta">Le ultime dal foglio Google</div></div>
      <div class="counts" id="demoCounts"></div>
    </div>
    <div class="table">
      <div class="tr thead"><span>Nome</span><span>Città</span><span>Venditore</span><span>Fissata</span><span>Esito</span></div>
      <div class="tbody" id="demos"></div>
    </div>
  </section>

  <section class="card glass side">
    <div class="card-head"><div><h2>Clienti di oggi</h2><div class="meta" id="clMeta"></div></div></div>
    <div class="clients" id="clients"></div>
  </section>

${tv ? "" : `  <section class="forms">
    <form class="form glass" id="clientForm">
      <h2>Nuovo cliente</h2>
      <p class="note">Ha pagato? Registralo qui: entra subito nell'incassato e compare sulla TV. Scrivi le prime lettere e ti suggerisce i nomi dal foglio Google.</p>
      <div class="row">
        <div><label for="cname">Nome cliente</label><input class="well" id="cname" list="cnames" maxlength="80" placeholder="Mario Rossi" autocomplete="off"></div>
        <div><label for="camount">Incassato (€)</label><input class="well" id="camount" inputmode="decimal" placeholder="1500" autocomplete="off"></div>
      </div>
      <datalist id="cnames"></datalist>
      <div class="msg" id="cmsg" role="status"></div>
      <button type="submit" class="btn">Registra cliente</button>
    </form>
    <form class="form glass" id="adsForm">
      <h2>Spesa ads</h2>
      <p class="note">I lead arrivano da soli dal foglio Google. La spesa ads per ora si scrive qui, giorno per giorno.</p>
      <div class="row">
        <div><label for="fdate">Giorno</label><input class="well" type="date" id="fdate"></div>
        <div><label for="fads">Spesa (€)</label><input class="well" id="fads" inputmode="decimal" placeholder="300" autocomplete="off"></div>
      </div>
      <div class="msg" id="msg" role="status"></div>
      <button type="submit" class="btn ghost">Salva spesa</button>
      <a class="tv-link" href="${DASH_PATH}/tv" target="_blank">Apri la schermata della TV</a>
    </form>
  </section>`}
</div>
<div class="toast glass" id="toast" role="status" aria-live="polite"><div class="k">Nuovo cliente</div><div class="n" id="toastName"></div><div class="a num" id="toastAmt"></div></div>

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
function money(n) {
  const c = Math.round(Math.abs(n) * 100), cents = c % 100;
  return '€ ' + (n < 0 ? '-' : '') + grp(Math.floor(c / 100)) + (cents ? ',' + String(cents).padStart(2, '0') : '');
}
const money0 = (n) => '€ ' + grp(n);
const kfmt = (v) => v >= 1000 ? nf1.format(v / 1000).replace(',0', '') + 'k' : grp(v);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
let data = null, curMonth = null, lastClientsKey = null, seen = null, lastNames = '';
const anims = {};

function setNum(id, to, kind) {
  const el = $(id);
  if (!el) return;
  const prev = el.dataset.v;
  el.dataset.v = to;
  const fmt = (v, done) => kind === 'money' ? (done ? money(v) : money0(v)) : grp(v);
  const from = prev === undefined ? null : Number(prev);
  if (from === null || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to, true); return; }
  cancelAnimationFrame(anims[id]);
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 1100);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)), p === 1);
    if (p < 1) anims[id] = requestAnimationFrame(step);
  };
  anims[id] = requestAnimationFrame(step);
}
function trend(diff, fmt) {
  if (!diff) return '<span>uguale a ieri</span>';
  return '<span class="' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '▲ ' : '▼ ') + fmt(Math.abs(diff)) + ' rispetto a ieri</span>';
}

// Napoleone si allinea al buco: la foto parte dall'alto della pagina e finisce poco sotto il buco.
function placeNapo() {
  const hole = $('hole'), napo = $('napo');
  const r = hole.getBoundingClientRect();
  const h = Math.round(r.bottom + window.scrollY + Math.min(80, r.height * 0.25));
  napo.style.height = h + 'px';
  napo.style.width = Math.round(h * 582 / 343) + 'px';
}

// ---- Grafico incassato (SVG disegnato alla misura reale del riquadro) ----
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
function tipAt(box, x, y, html) {
  let t = box.querySelector('.tip');
  if (!t) { t = document.createElement('div'); t.className = 'tip'; box.appendChild(t); }
  t.innerHTML = html;
  t.style.left = Math.max(60, Math.min(box.clientWidth - 60, x)) + 'px';
  t.style.top = Math.max(48, y) + 'px';
  t.classList.add('on');
}
function hideTip(box) { const t = box.querySelector('.tip'); if (t) t.classList.remove('on'); box.classList.remove('hovering'); }

function drawCash(box, series) {
  box.replaceChildren();
  const W = box.clientWidth, H = box.clientHeight;
  const m = { l: 44, r: 6, t: 24, b: 24 };
  const pw = Math.max(10, W - m.l - m.r), ph = Math.max(10, H - m.t - m.b);
  const past = series.filter((s) => !s.future);
  const maxV = Math.max.apply(null, past.map((s) => s.cashed).concat([0]));
  const max = niceMax(maxV);
  const y = (v) => m.t + ph - (v / max) * ph, base = m.t + ph;
  const svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Incassato giorno per giorno' });
  [0, 0.5, 1].forEach((f) => {
    const yy = base - ph * f;
    svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'grid' }));
    svg.appendChild(el('text', { x: m.l - 10, y: yy + 4, 'text-anchor': 'end', class: 'axis' }, kfmt(max * f)));
  });
  const slot = pw / series.length, ti = series.findIndex((s) => s.today), every = W < 520 ? 10 : 5;
  series.forEach((s, i) => {
    const show = s.today || ((s.d === 1 || s.d % every === 0) && (ti < 0 || Math.abs(i - ti) * slot > 28));
    if (show) svg.appendChild(el('text', { x: m.l + slot * i + slot / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' + (s.today ? ' today' : '') }, s.today ? 'oggi' : s.d));
  });
  const bw = Math.max(3, Math.min(26, slot * 0.58));
  const bars = [];
  series.forEach((s, i) => {
    if (s.future) return;
    const x = m.l + slot * i + (slot - bw) / 2, v = s.cashed;
    let bar = null;
    if (v > 0) {
      const top = y(v), h = base - top, r = Math.min(4, bw / 2, h);
      bar = el('path', { class: 'bar' + (s.today ? ' is-today' : ''), d: 'M' + x + ',' + base + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + top + ' ' + (x + bw) + ',' + (top + r) + 'V' + base + 'Z' });
      svg.appendChild(bar);
      if (s.today || v === maxV) svg.appendChild(el('text', { x: x + bw / 2, y: top - 8, 'text-anchor': 'middle', class: 'val' }, kfmt(v)));
    }
    bars.push({ s, x: x + bw / 2, y: v > 0 ? y(v) : base, bar, i });
  });
  bars.forEach((b) => {
    const hit = el('rect', { class: 'hit', x: m.l + slot * b.i, y: m.t, width: slot, height: ph });
    const on = () => {
      box.classList.add('hovering');
      bars.forEach((o) => o.bar && o.bar.classList.toggle('hot', o === b));
      tipAt(box, b.x, b.y, '<span>' + esc(dayLabel(b.s.date)) + '</span><b>' + money(b.s.cashed) + '</b>');
    };
    hit.addEventListener('mouseenter', on);
    hit.addEventListener('click', on);
    hit.addEventListener('mouseleave', () => hideTip(box));
    svg.appendChild(hit);
  });
  box.appendChild(svg);
  if (!past.some((s) => s.cashed > 0)) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = past.length ? 'Nessun incasso registrato in questo mese' : 'Mese non ancora iniziato';
    box.appendChild(e);
  }
}

let rz;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { placeNapo(); if (data) drawCash($('chCash'), data.series); }, 120); });
if (document.fonts) document.fonts.ready.then(placeNapo);
placeNapo();

// ---- Annuncio nuovo cliente ----
let toastT;
function announce(c) {
  $('toastName').textContent = c.name;
  $('toastAmt').textContent = '+ ' + money(c.amount);
  $('toast').classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('on'), 4500);
}

function whenLabel(x, today) {
  if (!x.date) return '';
  const y = new Date(today + 'T12:00:00'); y.setDate(y.getDate() - 1);
  const yIso = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  const d = x.date === today ? 'oggi' : x.date === yIso ? 'ieri' : new Date(x.date + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return d + (x.time ? ' ' + x.time : '');
}
function esitoClass(o) {
  const s = o.toLowerCase();
  if (/vint|chius|cliente|pres/.test(s)) return 'good';
  if (/pers|no |non |annull|disdett/.test(s + ' ')) return 'bad';
  return '';
}

function render(d) {
  const firstLoad = data === null;
  data = d; curMonth = d.month.ym;
  const t = d.todayData, mo = d.month, monthName = mo.label.split(' ')[0];
  $('date').textContent = cap(new Date(d.today + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }));
  $('alert').textContent = 'Foglio Google non raggiungibile';
  $('alert').classList.toggle('on', !d.sheetOk);

  // Incassato oggi
  setNum('kToday', t.cashed, 'money');
  const nC = t.clients.length;
  $('kTodaySub').innerHTML = '<div class="stat">' + (nC ? '<b>' + nC + '</b> ' + (nC === 1 ? 'cliente' : 'clienti') : 'Ancora nessun cliente') + '</div>' +
    '<div class="stat">' + trend(Math.round((t.cashed - d.yesterday.cashed) * 100) / 100, money0) + '</div>';

  // Incassato del mese e proiezione
  $('kMonthLabel').textContent = 'Incassato a ' + monthName;
  setNum('kMonth', mo.cashed, 'money');
  $('kMonthSub').innerHTML =
    (mo.projection != null ? '<span>Proiezione <b>' + money0(mo.projection) + '</b></span>' : mo.projectionNote ? '<span>' + esc(mo.projectionNote) + '</span>' : mo.isFuture ? '' : '<span>Mese chiuso</span>') +
    (mo.clients ? '<span><b>' + mo.clients + '</b> ' + (mo.clients === 1 ? 'cliente' : 'clienti') + '</span>' : '');

  // Lead
  setNum('kLeads', t.leads, 'int');
  $('kLeadsSub').innerHTML = '<span class="chip' + (t.toCall ? '' : ' ok') + '"><i></i>' + grp(t.toCall || 0) + ' da chiamare</span>' + trend(t.leads - d.yesterday.leads, grp);

  // Ritorno sulla spesa ads del mese
  $('kRoasLabel').textContent = 'Ritorno sulle ads a ' + monthName;
  $('kRoas').textContent = mo.roas != null ? nf1.format(mo.roas).replace(',0', '') + 'x' : 'n.d.';
  $('kRoasSub').innerHTML = mo.adsSpend > 0
    ? '<span><b>' + money0(mo.adsSpend) + '</b> spesi</span>' + (mo.cpl != null ? '<span>CPL <b>' + money0(mo.cpl) + '</b></span>' : '') + (mo.cac != null ? '<span>CAC <b>' + money0(mo.cac) + '</b></span>' : '')
    : '<span>Scrivi la spesa ads per vedere CPL e CAC</span>';

  // Grafico
  $('mLabel').textContent = cap(mo.label);
  $('mNext').disabled = mo.isCurrent || mo.isFuture;
  const best = d.series.filter((s) => !s.future).reduce((b, s) => (s.cashed > (b ? b.cashed : 0) ? s : b), null);
  $('cashMeta').textContent = best ? 'Giorno migliore: ' + dayLabel(best.date) + ', ' + money0(best.cashed) : 'Nessun incasso in questo mese';
  drawCash($('chCash'), d.series);

  // Demo fissate
  if (d.demos) {
    $('demoCounts').innerHTML = '<span class="count"><b>' + d.demos.today + '</b> oggi</span><span class="count"><b>' + d.demos.month + '</b> questo mese</span>';
    $('demos').innerHTML = d.demos.list.length ? d.demos.list.map((x) =>
      '<div class="tr"><span class="n">' + esc(x.name) + '</span><span class="c">' + esc(x.city || ' ') + '</span><span class="v">' + esc(x.seller || ' ') + '</span>' +
      '<span class="w' + (x.date === d.today ? ' today' : '') + '">' + esc(whenLabel(x, d.today)) + '</span>' +
      '<span class="esito ' + esitoClass(x.outcome) + '"><i></i>' + esc(x.outcome || 'In attesa') + '</span></div>'
    ).join('') : '<div class="none">Nessuna demo fissata nel foglio.</div>';
  } else {
    $('demoCounts').innerHTML = '';
    $('demos').innerHTML = '<div class="none">Il foglio Google non risponde: le demo torneranno appena è raggiungibile.</div>';
  }

  // Clienti di oggi
  const list = t.clients.slice().reverse();
  const key = list.map((c) => c.id).join(',');
  if (key !== lastClientsKey) {
    lastClientsKey = key;
    const fresh = seen ? list.filter((c) => !seen.has(c.id)) : [];
    $('clMeta').textContent = nC ? money0(t.cashed) + ' da ' + plural(nC, 'cliente', 'clienti') : '';
    $('clients').innerHTML = list.length ? list.map((c) =>
      '<div class="cl' + (fresh.indexOf(c) >= 0 ? ' new' : '') + '"><div class="av">' + esc((c.name.trim()[0] || '?').toUpperCase()) + '</div>' +
      '<div class="who"><div class="name">' + esc(c.name) + '</div><div class="time">' + new Date(c.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + '</div></div>' +
      '<div class="amt num">' + money(c.amount) + '</div>' +
      (tvMode ? '' : '<button type="button" class="del" data-id="' + esc(c.id) + '">Elimina</button>') + '</div>'
    ).join('') : '<div class="none">Il primo cliente di oggi comparirà qui.</div>';
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
  placeNapo();
}

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
    if (!isFinite(amount) || amount <= 0) { $('cmsg').textContent = "Scrivi l'importo incassato, ad esempio 1500"; return; }
    $('cmsg').textContent = 'Registro…';
    try {
      render(await post(API + '/client', { date: data.today, name, amount }));
      $('cname').value = ''; $('camount').value = '';
      $('cmsg').textContent = name + ' registrato';
    } catch (err) { $('cmsg').textContent = 'Non registrato: controlla la connessione e riprova'; }
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
    if (!isFinite(adsSpend) || adsSpend < 0) { $('msg').textContent = 'Scrivi la spesa, ad esempio 300'; return; }
    $('msg').textContent = 'Salvo…';
    try {
      render(await post(API, { date: $('fdate').value, adsSpend }));
      $('msg').textContent = 'Spesa salvata';
    } catch (err) { $('msg').textContent = 'Non salvata: controlla la connessione e riprova'; }
  };

  // Primo clic: "Sicuro?", secondo clic: elimina
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
