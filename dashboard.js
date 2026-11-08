// Dashboard soldi/lead per l'ufficio (e per la TV).
// Pagine: /dashboardvenditatop    = PC, per inserire i numeri del giorno
//         /dashboardvenditatop/tv = TV, mostra i numeri in tempo reale
// I dati stanno nel KV ACADEMY_PROGRESS con chiave "fatturato:AAAA-MM-GG" (giorno di Roma).
// Ogni giorno ha: cashed (incassato), adsSpend (spesa ads), leads (lead arrivati), toCall (lead ancora da chiamare, istantaneo).
// Lead e spesa ads sono inseriti a mano per ora: quando collegheremo GoHighLevel/Meta Ads questi numeri potranno arrivare in automatico senza cambiare il resto.

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

function romeDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
}

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

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}

const round2 = (n) => Math.round(n * 100) / 100;
const num = (n) => (isFinite(n) ? round2(n) : 0);

async function readDay(kv, date) {
  const raw = await kv.get(`fatturato:${date}`);
  if (!raw) return null;
  const d = JSON.parse(raw);
  return { cashed: num(d.cashed), adsSpend: num(d.adsSpend), leads: num(d.leads), toCall: num(d.toCall) };
}

const EMPTY_DAY = { cashed: 0, adsSpend: 0, leads: 0, toCall: 0 };
const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });

async function monthPayload(kv, ym, today) {
  const nDays = daysInMonth(ym);
  const dates = Array.from({ length: nDays }, (_, i) => `${ym}-${pad2(i + 1)}`);
  const records = await Promise.all(dates.map((d) => readDay(kv, d)));
  const days = {};
  dates.forEach((d, i) => { if (records[i]) days[d] = records[i]; });

  const todayYm = today.slice(0, 7);
  const upTo = ym === todayYm ? Number(today.slice(8, 10)) : nDays;
  const loggedDates = dates.slice(0, upTo).filter((d) => days[d]);

  const sum = (f) => round2(loggedDates.reduce((s, d) => s + (days[d][f] || 0), 0));
  const cashed = sum("cashed"), adsSpend = sum("adsSpend"), leads = sum("leads");
  const cpl = leads > 0 ? round2(adsSpend / leads) : null;

  let projection = null, projectionNote = null;
  if (ym === todayYm) {
    if (loggedDates.length >= 3) {
      projection = round2((cashed / loggedDates.length) * nDays);
    } else {
      projectionNote = `Servono almeno 3 giorni con dati inseriti in questo mese per una proiezione (ce ne sono ${loggedDates.length}).`;
    }
  }

  // Settimana: ultimi 7 giorni (oggi compreso), anche se a cavallo tra due mesi.
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).reverse();
  const weekRecords = await Promise.all(weekDates.map((d) => (days[d] !== undefined ? days[d] : readDay(kv, d))));
  const weekSum = (f) => round2(weekRecords.reduce((s, r) => s + (r ? r[f] || 0 : 0), 0));
  const weekLeads = weekSum("leads"), weekAds = weekSum("adsSpend");

  return {
    today,
    todayData: days[today] || EMPTY_DAY,
    days,
    week: {
      from: weekDates[0], to: weekDates[6],
      cashed: weekSum("cashed"), adsSpend: weekAds, leads: weekLeads,
      cpl: weekLeads > 0 ? round2(weekAds / weekLeads) : null,
    },
    month: {
      ym, label: MONTH_LABEL.format(new Date(ym + "-01T12:00:00Z")),
      daysInMonth: nDays, loggedDays: loggedDates.length,
      cashed, adsSpend, leads, cpl, projection, projectionNote,
      isCurrent: ym === todayYm, isFuture: ym > todayYm,
    },
  };
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#000000">
<link rel="icon" type="image/png" href="/assets/img/logo.png">`;

function loginPage(error, tv = false) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Dashboard Vendita Uno · Accedi</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; }
  form { width: 100%; max-width: 360px; text-align: center; }
  h1 { font-size: 1.4rem; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 28px; }
  input { width: 100%; padding: 14px; font-size: 1.1rem; background: #111; color: #fff; border: 1px solid #333; border-radius: 10px; margin-bottom: 14px; text-align: center; }
  button { width: 100%; padding: 14px; font-size: 1.05rem; font-weight: 700; background: #fff; color: #000; border: 0; border-radius: 10px; cursor: pointer; }
  .err { color: #f87171; margin-bottom: 14px; }
</style>
</head>
<body>
<form method="POST" action="${DASH_PATH}/login${tv ? "?tv=1" : ""}">
  <h1>Dashboard Vendita Uno</h1>
  ${error ? `<p class="err">${error}</p>` : ""}
  <input type="password" name="password" placeholder="Password" required autofocus autocomplete="current-password">
  <button type="submit">Entra</button>
</form>
</body>
</html>`;
}

// tv = true: solo visualizzazione (per la TV). tv = false: pagina del PC per inserire i numeri.
function dashboardPage(tv) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Dashboard Vendita Uno${tv ? " · TV" : ""}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #000; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .num { font-variant-numeric: tabular-nums; }
  body.tv, body.tv .screen { height: 100vh; overflow: hidden; }

  .screen { padding: 3vh 4vw 4vh; max-width: 1200px; margin: 0 auto; }
  .top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
  .top .date { font-size: clamp(1rem, 1.8vw, 1.6rem); opacity: 0.8; text-transform: capitalize; }
  .top .clock { font-size: clamp(1rem, 1.8vw, 1.6rem); opacity: 0.6; }

  .napo { display: flex; align-items: center; gap: 10px; }
  .napo img { height: clamp(46px, 7vh, 86px); border-radius: 8px; filter: saturate(1.05) contrast(1.05); }
  .napo .say { font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; font-size: clamp(0.75rem, 1.3vw, 1.1rem); color: #ffd84a; transform: rotate(-2deg); line-height: 1.15; max-width: 12em; }

  h2.section { margin: 3.5vh 0 1.4vh; font-size: clamp(0.85rem, 1.4vw, 1.3rem); font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.55; border-top: 1px solid #222; padding-top: 2.4vh; }
  h2.section.first { border-top: 0; padding-top: 0; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.4vw; }
  .kpi { background: #0a0a0a; border: 1px solid #262626; border-radius: 16px; padding: 2.4vh 1.2vw; text-align: center; }
  .kpi .label { font-size: clamp(0.72rem, 1.1vw, 1rem); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
  .kpi .value { font-size: clamp(1.7rem, 4.6vw, 3.6rem); font-weight: 900; line-height: 1.1; margin-top: 0.6vh; letter-spacing: -0.02em; }
  .kpi .value.money::before { content: "€ "; }
  .kpi .sub { font-size: clamp(0.72rem, 1vw, 0.95rem); opacity: 0.5; margin-top: 0.4vh; }
  .bump { animation: bump 1.2s ease-out; }
  @keyframes bump { 0% { transform: scale(1); } 15% { transform: scale(1.07); } 100% { transform: scale(1); } }

  .row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.4vw; }

  .monthnav { display: flex; align-items: center; gap: 10px; }
  .monthnav button { background: #111; border: 1px solid #333; color: #fff; width: 34px; height: 34px; border-radius: 8px; font-size: 1.1rem; cursor: pointer; }
  .monthnav button:disabled { opacity: 0.3; cursor: default; }
  .monthnav .lbl { font-weight: 800; text-transform: capitalize; min-width: 11em; text-align: center; }

  .proj { margin-top: 1.4vh; background: #0a0a0a; border: 1px dashed #333; border-radius: 14px; padding: 1.8vh 2vw; font-size: clamp(0.85rem, 1.1vw, 1.05rem); }
  .proj b { font-size: 1.3em; }
  .proj.muted { opacity: 0.55; border-style: dashed; }

  .status { position: fixed; bottom: 1.5vh; left: 4vw; font-size: 0.9rem; opacity: 0; }
  .status.offline { opacity: 0.6; }

  /* ---- Form inserimento (solo PC) ---- */
  .panel { display: flex; justify-content: center; padding: 1vh 16px 60px; }
  .card { width: 100%; max-width: 560px; background: #0a0a0a; border: 1px solid #262626; border-radius: 16px; padding: 26px; }
  .card h2 { margin: 0 0 6px; font-size: 1.1rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .card .note { font-size: 0.82rem; opacity: 0.55; margin: 0 0 18px; }
  .card label { display: block; font-size: 0.85rem; opacity: 0.7; margin-bottom: 6px; }
  .card input { width: 100%; padding: 13px; font-size: 1.1rem; background: #111; color: #fff; border: 1px solid #333; border-radius: 10px; margin-bottom: 14px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .btn-main { width: 100%; padding: 14px; font-size: 1rem; font-weight: 700; border-radius: 10px; cursor: pointer; border: 0; background: #fff; color: #000; }
  .msg { min-height: 1.3em; font-size: 0.9rem; margin: 4px 0 10px; text-align: center; }
  .tv-link { display: block; text-align: center; color: #fff; opacity: 0.6; font-size: 0.9rem; margin-top: 18px; }

  @media (max-width: 760px) {
    .kpis { grid-template-columns: 1fr 1fr; }
    .row3 { grid-template-columns: 1fr; }
    .napo .say { max-width: 8em; }
  }
</style>
</head>
<body class="${tv ? "tv" : "pc"}">
<div class="screen" id="screen">
  <div class="top">
    <div><span class="date" id="date"></span></div>
    <div class="napo">
      <span class="say">Conquistiamo <span id="clock" class="num"></span></span>
      <img src="/assets/img/napoleone.jpg" alt="Napoleone che ci carica">
    </div>
  </div>

  <h2 class="section first">Oggi</h2>
  <div class="kpis">
    <div class="kpi"><div class="label">Incassato</div><div class="value money num" id="t-cashed">0</div></div>
    <div class="kpi"><div class="label">Spesa ads</div><div class="value money num" id="t-ads">0</div></div>
    <div class="kpi"><div class="label">Lead arrivati</div><div class="value num" id="t-leads">0</div></div>
    <div class="kpi"><div class="label">Lead da chiamare</div><div class="value num" id="t-tocall">0</div></div>
  </div>

  <h2 class="section">Ultimi 7 giorni</h2>
  <div class="row3">
    <div class="kpi"><div class="label">Incassato</div><div class="value money num" id="w-cashed">0</div></div>
    <div class="kpi"><div class="label">Spesa ads</div><div class="value money num" id="w-ads">0</div></div>
    <div class="kpi"><div class="label">Lead arrivati</div><div class="value num" id="w-leads">0</div><div class="sub" id="w-cpl"></div></div>
  </div>

  <h2 class="section">
    <div class="monthnav">
      <button type="button" id="mPrev">‹</button>
      <span class="lbl" id="mLabel">...</span>
      <button type="button" id="mNext">›</button>
    </div>
  </h2>
  <div class="row3">
    <div class="kpi"><div class="label">Incassato</div><div class="value money num" id="m-cashed">0</div></div>
    <div class="kpi"><div class="label">Spesa ads</div><div class="value money num" id="m-ads">0</div></div>
    <div class="kpi"><div class="label">Lead arrivati</div><div class="value num" id="m-leads">0</div><div class="sub" id="m-cpl"></div></div>
  </div>
  <div class="proj" id="proj"></div>
</div>
<div class="status" id="status">Connessione persa, riprovo…</div>

${tv ? "" : `<div class="panel">
  <form class="card" id="addForm">
    <h2>Inserisci / correggi un giorno</h2>
    <p class="note">Lead e spesa ads sono manuali per ora. In futuro potremo collegarli a GoHighLevel e a Meta/Google Ads senza cambiare questa pagina.</p>
    <label for="fdate">Giorno</label>
    <input type="date" id="fdate">
    <div class="two">
      <div><label for="fcashed">Incassato (€)</label><input id="fcashed" inputmode="decimal" placeholder="es. 1500" autocomplete="off"></div>
      <div><label for="fads">Spesa ads (€)</label><input id="fads" inputmode="decimal" placeholder="es. 300" autocomplete="off"></div>
    </div>
    <div class="two">
      <div><label for="fleads">Lead arrivati</label><input id="fleads" inputmode="numeric" placeholder="es. 12" autocomplete="off"></div>
      <div><label for="ftocall">Lead ancora da chiamare</label><input id="ftocall" inputmode="numeric" placeholder="es. 5" autocomplete="off"></div>
    </div>
    <div class="msg" id="msg"></div>
    <button type="submit" class="btn-main">Salva</button>
    <a class="tv-link" href="${DASH_PATH}/tv" target="_blank">Apri la schermata della TV ↗</a>
  </form>
</div>`}

<script>
const API = '${DASH_PATH}/api';
const eur = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (id) => document.getElementById(id);
let last = null, curMonth = null, todayStr = null;
const anims = {};

function fmtMoney(n) { return Number.isInteger(n) ? eur.format(n) : eur2.format(n); }
function fmtInt(n) { return eur.format(Math.round(n)); }

function animateTo(id, from, to, money) {
  const el = $(id);
  if (!el) return;
  cancelAnimationFrame(anims[id]);
  const start = performance.now(), dur = 1200;
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
    el.textContent = p < 1 ? fmtInt(v) : (money ? fmtMoney(to) : fmtInt(to));
    if (p < 1) anims[id] = requestAnimationFrame(step);
  };
  anims[id] = requestAnimationFrame(step);
  if (to > from) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

function setVal(id, to, money) {
  const el = $(id);
  if (!el) return;
  const from = Number((el.textContent || '0').replace(/[^0-9,.\\-]/g, '').replace(',', '.')) || 0;
  if (last === null) el.textContent = money ? fmtMoney(to) : fmtInt(to);
  else if (from !== to) animateTo(id, from, to, money);
}

function render(d) {
  todayStr = d.today;
  $('date').textContent = new Date(d.today + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('clock').textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  setVal('t-cashed', d.todayData.cashed, true);
  setVal('t-ads', d.todayData.adsSpend, true);
  setVal('t-leads', d.todayData.leads, false);
  setVal('t-tocall', d.todayData.toCall, false);

  setVal('w-cashed', d.week.cashed, true);
  setVal('w-ads', d.week.adsSpend, true);
  setVal('w-leads', d.week.leads, false);
  $('w-cpl').textContent = d.week.cpl != null ? 'CPL ' + fmtMoney(d.week.cpl) : '';

  curMonth = d.month.ym;
  $('mLabel').textContent = d.month.label;
  $('mPrev').disabled = false;
  $('mNext').disabled = d.month.isCurrent || d.month.isFuture;
  setVal('m-cashed', d.month.cashed, true);
  setVal('m-ads', d.month.adsSpend, true);
  setVal('m-leads', d.month.leads, false);
  $('m-cpl').textContent = d.month.cpl != null ? 'CPL ' + fmtMoney(d.month.cpl) : '';

  const proj = $('proj');
  if (d.month.projection != null) {
    proj.className = 'proj';
    proj.innerHTML = 'Proiezione incassato a fine mese: <b>' + fmtMoney(d.month.projection) + '</b> (basata su ' + d.month.loggedDays + ' giorni inseriti su ' + d.month.daysInMonth + ')';
  } else if (d.month.projectionNote) {
    proj.className = 'proj muted';
    proj.textContent = d.month.projectionNote;
  } else {
    proj.className = 'proj muted';
    proj.textContent = d.month.isFuture ? 'Mese futuro: nessun dato.' : 'Mese chiuso: questo è il totale reale, non una proiezione.';
  }

  last = d;

  if ($('fdate') && !$('fdate').value) {
    $('fdate').value = d.today;
    $('fdate').max = d.today;
    fillFormFor(d.todayData);
  }
}

function fillFormFor(day) {
  $('fcashed').value = day.cashed || '';
  $('fads').value = day.adsSpend || '';
  $('fleads').value = day.leads || '';
  $('ftocall').value = day.toCall || '';
}

async function refresh(ym) {
  try {
    const r = await fetch(API + (ym ? '?month=' + ym : ''), { cache: 'no-store' });
    if (r.status === 401) { location.reload(); return; }
    render(await r.json());
    $('status').classList.remove('offline');
  } catch (e) { $('status').classList.add('offline'); }
}

refresh(); setInterval(() => refresh(curMonth), 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(curMonth); });

async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch (e) {} }
keepAwake(); document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
$('screen').addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());

$('mPrev').onclick = () => { const [y, m] = curMonth.split('-').map(Number); const t = y * 12 + (m - 1) - 1; refresh(Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0')); };
$('mNext').onclick = () => { if ($('mNext').disabled) return; const [y, m] = curMonth.split('-').map(Number); const t = y * 12 + (m - 1) + 1; refresh(Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0')); };

if ($('addForm')) {
  function parseAmount(s) {
    s = (s || '').toString().replace(/[€\\s]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\\./g, '').replace(',', '.');
    else if (/^\\d{1,3}(\\.\\d{3})+$/.test(s)) s = s.replace(/\\./g, '');
    return Number(s);
  }

  $('fdate').onchange = async () => {
    const date = $('fdate').value;
    try {
      const r = await fetch(API + '?month=' + date.slice(0, 7), { cache: 'no-store' });
      const d = await r.json();
      fillFormFor((d.days && d.days[date]) || { cashed: 0, adsSpend: 0, leads: 0, toCall: 0 });
    } catch (e) {}
  };

  $('addForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      date: $('fdate').value,
      cashed: parseAmount($('fcashed').value),
      adsSpend: parseAmount($('fads').value),
      leads: parseAmount($('fleads').value),
      toCall: parseAmount($('ftocall').value),
    };
    if (Object.values(payload).slice(1).some((n) => !isFinite(n) || n < 0)) { $('msg').textContent = 'Valori non validi'; return; }
    $('msg').textContent = 'Salvo…';
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error();
      render(await r.json());
      $('msg').textContent = '✓ Salvato';
    } catch (err) { $('msg').textContent = 'Errore, riprova'; }
  };
}
</script>
</body>
</html>`;
}

export async function handleDashboard(request, env, url) {
  const kv = env.ACADEMY_PROGRESS;
  if (!kv) return new Response("KV not configured", { status: 500 });
  const path = url.pathname.replace(/\/+$/, "");

  if (path === `${DASH_PATH}/login` && request.method === "POST") {
    const form = await request.formData();
    const ok = await checkDashPassword((form.get("password") || "").toString());
    if (!ok) return html(loginPage("Password non corretta."));
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await kv.put(`dashsess:${token}`, "1", { expirationTtl: DASH_SESSION_DAYS * 86400 });
    return new Response(null, {
      status: 302,
      headers: {
        Location: url.searchParams.get("tv") ? `${DASH_PATH}/tv` : DASH_PATH,
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
      return json(await monthPayload(kv, ym, today));
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : today;
      if (date > today) return json({ error: "data non valida" }, 400);
      const valid = (n) => isFinite(n) && n >= 0 && n <= 100000000;
      const cashed = round2(Number(body.cashed) || 0);
      const adsSpend = round2(Number(body.adsSpend) || 0);
      const leads = Math.round(Number(body.leads) || 0);
      const toCall = Math.round(Number(body.toCall) || 0);
      if (![cashed, adsSpend, leads, toCall].every(valid)) return json({ error: "valori non validi" }, 400);
      await kv.put(`fatturato:${date}`, JSON.stringify({ cashed, adsSpend, leads, toCall }));
      return json(await monthPayload(kv, date.slice(0, 7), today));
    }

    return new Response("Method not allowed", { status: 405 });
  }

  if (path === DASH_PATH || path === `${DASH_PATH}/login`) {
    return html(loggedIn ? dashboardPage(false) : loginPage(null));
  }

  if (path === `${DASH_PATH}/tv` || path === TV_PATH) {
    return html(loggedIn ? dashboardPage(true) : loginPage(null, true));
  }

  return new Response(null, { status: 302, headers: { Location: DASH_PATH } });
}
