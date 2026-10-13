// Dashboard "Fatturato del giorno" per la TV dell'ufficio.
// Pagine: /dashboardvenditatop    = PC, per inserire il fatturato
//         /dashboardvenditatop/tv = TV, mostra il totale che arriva in tempo reale
// I dati stanno nel KV ACADEMY_PROGRESS con chiave "fatturato:AAAA-MM-GG" (giorno di Roma).

export const DASH_PATH = "/dashboardvenditatop";

// I sales in classifica. Per aggiungerne uno basta scrivere il nome qui.
const SELLERS = ["Samuele", "Marco", "Tomas", "Elio"];

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

async function readDay(kv, date) {
  const raw = await kv.get(`fatturato:${date}`);
  return raw ? JSON.parse(raw) : { entries: [] };
}

const round2 = (n) => Math.round(n * 100) / 100;

function summary(date, day) {
  const sum = (list, f) => round2(list.reduce((s, e) => s + (e[f] || 0), 0));
  const ranking = SELLERS.map((name) => {
    const mine = day.entries.filter((e) => e.seller === name);
    return { name, total: sum(mine, "amount"), cashed: sum(mine, "cashed") };
  }).sort((a, b) => b.total - a.total || b.cashed - a.cashed);
  return {
    date,
    total: sum(day.entries, "amount"),
    cashed: sum(day.entries, "cashed"),
    count: day.entries.filter((e) => e.amount).length,
    ranking,
    entries: day.entries.slice().reverse(),
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
<title>Fatturato del giorno — Accedi</title>
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
  <h1>Fatturato del giorno</h1>
  ${error ? `<p class="err">${error}</p>` : ""}
  <input type="password" name="password" placeholder="Password" required autofocus autocomplete="current-password">
  <button type="submit">Entra</button>
</form>
</body>
</html>`;
}

// tv = true: solo visualizzazione (per la TV). tv = false: pagina del PC per inserire.
function dashboardPage(tv) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Fatturato del giorno${tv ? " — TV" : ""}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #000; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
  .num { font-variant-numeric: tabular-nums; }

  /* ---- Schermata TV ---- */
  .screen { height: 100vh; display: flex; flex-direction: column; padding: 4vh 4vw; gap: 4vh; }
  .top { display: flex; justify-content: space-between; align-items: baseline; font-size: clamp(1rem, 2.2vw, 2.4rem); }
  .top .date { opacity: 0.7; text-transform: capitalize; }
  .top .clock { opacity: 0.7; }
  .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 4vw; }
  .kpi { text-align: center; }
  .kpi .label { font-size: clamp(1.1rem, 2.8vw, 3.2rem); font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
  .kpi .value { font-size: clamp(2.6rem, 8.5vw, 11rem); font-weight: 900; line-height: 1.05; margin-top: 1.5vh; letter-spacing: -0.02em; }
  .kpi .sub { font-size: clamp(0.9rem, 1.8vw, 2rem); opacity: 0.6; margin-top: 1vh; }
  .bump { animation: bump 1.2s ease-out; }
  @keyframes bump { 0% { transform: scale(1); } 15% { transform: scale(1.08); } 100% { transform: scale(1); } }

  .rank { flex: 1; display: flex; flex-direction: column; min-height: 0; border-top: 1px solid #333; padding-top: 3vh; }
  .rank h2 { margin: 0 0 2.5vh; font-size: clamp(1rem, 2.2vw, 2.6rem); font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; text-align: center; }
  .rows { flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 1vh; }
  .row { display: grid; grid-template-columns: 3.2em 7em 1fr auto; align-items: center; gap: 1.2vw; font-size: clamp(1rem, 2.6vw, 3.2rem); }
  .row .pos { font-weight: 900; opacity: 0.6; }
  .row .name { font-weight: 800; }
  .row .bar { height: 0.55em; background: #1a1a1a; border-radius: 999px; overflow: hidden; }
  .row .bar i { display: block; height: 100%; background: #fff; border-radius: 999px; width: 0; transition: width 1.2s ease-out; }
  .row .amt { font-weight: 800; text-align: right; min-width: 6em; }
  .row .amt small { display: block; font-size: 0.5em; font-weight: 500; opacity: 0.6; }
  .row.first .pos, .row.first .name { opacity: 1; }

  .flash { position: fixed; left: 50%; top: 40vh; transform: translateX(-50%); font-size: clamp(1.5rem, 5vw, 6rem); font-weight: 800; opacity: 0; pointer-events: none; background: #000; padding: 0.2em 0.6em; border: 2px solid #fff; border-radius: 0.4em; white-space: nowrap; }
  .flash.show { animation: flash 3.5s ease-out; }
  @keyframes flash { 0% { opacity: 0; transform: translate(-50%, 2vh); } 10% { opacity: 1; transform: translate(-50%, 0); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -2vh); } }
  .status { position: fixed; bottom: 1.5vh; left: 4vw; font-size: 0.9rem; opacity: 0; }
  .status.offline { opacity: 0.6; }

  /* ---- Pagina del PC ---- */
  body.pc { overflow: auto; height: auto; }
  body.pc .screen { height: auto; padding: 4vh 16px 2vh; max-width: 900px; margin: 0 auto; }
  body.pc .kpi .value { font-size: clamp(2rem, 7vw, 4.5rem); }
  body.pc .kpi .label { font-size: 1rem; }
  body.pc .row { font-size: clamp(0.95rem, 2.4vw, 1.3rem); }
  body.pc .rank { flex: none; }
  body.pc .flash { display: none; }
  .panel { display: flex; justify-content: center; padding: 8px 16px 48px; }
  .card { width: 100%; max-width: 520px; background: #000; border: 1px solid #333; border-radius: 16px; padding: 28px; }
  .card h2 { margin: 0 0 20px; font-size: 1.2rem; letter-spacing: 0.1em; text-transform: uppercase; }
  .card label { display: block; font-size: 0.85rem; opacity: 0.7; margin-bottom: 6px; }
  .card input { width: 100%; padding: 14px; font-size: 1.2rem; background: #111; color: #fff; border: 1px solid #333; border-radius: 10px; margin-bottom: 14px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .sellers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .sellers button { padding: 12px 4px; font-size: 1rem; font-weight: 700; background: #111; color: #fff; border: 1px solid #333; border-radius: 10px; cursor: pointer; }
  .sellers button.on { background: #fff; color: #000; border-color: #fff; }
  .btn-main { width: 100%; padding: 14px; font-size: 1rem; font-weight: 700; border-radius: 10px; cursor: pointer; border: 0; background: #fff; color: #000; }
  .hint { font-size: 0.8rem; opacity: 0.55; margin: -6px 0 14px; }
  .msg { min-height: 1.3em; font-size: 0.9rem; margin: 4px 0 10px; }
  .list { margin-top: 22px; border-top: 1px solid #222; padding-top: 14px; }
  .list h3 { margin: 0 0 10px; font-size: 0.85rem; opacity: 0.7; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
  .item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #1a1a1a; font-size: 0.95rem; }
  .item .who { font-weight: 700; width: 5.5em; flex: none; }
  .item .vals { flex: 1; min-width: 0; }
  .item .vals b { font-variant-numeric: tabular-nums; }
  .item .vals span { display: block; opacity: 0.6; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .time { opacity: 0.5; font-size: 0.8rem; }
  .item .del { background: none; border: 1px solid #7f1d1d; color: #f87171; cursor: pointer; font-size: 0.85rem; font-weight: 700; padding: 6px 12px; border-radius: 8px; flex: none; }
  .item .del:hover { background: #2a0a0a; }
  .item .del.sure { background: #dc2626; border-color: #dc2626; color: #fff; }
  .tv-link { display: block; text-align: center; color: #fff; opacity: 0.6; font-size: 0.9rem; margin-top: 18px; }
  @media (max-width: 600px) {
    .kpis { grid-template-columns: 1fr; gap: 3vh; }
    .row { grid-template-columns: 2em 5em 1fr auto; }
  }
</style>
</head>
<body${tv ? "" : ' class="pc"'}>
<div class="screen" id="screen">
  <div class="top"><span class="date" id="date"></span><span class="clock num" id="clock"></span></div>
  <div class="kpis">
    <div class="kpi"><div class="label">Fatturato del giorno</div><div class="value num" id="total">€ 0</div><div class="sub" id="count"></div></div>
    <div class="kpi"><div class="label">Incassato del giorno</div><div class="value num" id="cashed">€ 0</div><div class="sub" id="cashedSub"></div></div>
  </div>
  <div class="rank">
    <h2>Classifica sales</h2>
    <div class="rows" id="rows"></div>
  </div>
</div>
<div class="flash" id="flash"></div>
<div class="status" id="status">Connessione persa, riprovo…</div>

${tv ? "" : `<div class="panel">
  <form class="card" id="addForm">
    <h2>Aggiungi vendita</h2>
    <label>Sales</label>
    <div class="sellers" id="sellers">${SELLERS.map((s) => `<button type="button" data-s="${s}">${s}</button>`).join("")}</div>
    <div class="two">
      <div><label for="amount">Fatturato (€)</label><input id="amount" inputmode="decimal" placeholder="es. 1500" autocomplete="off"></div>
      <div><label for="cashedIn">Incassato (€)</label><input id="cashedIn" inputmode="decimal" placeholder="es. 500" autocomplete="off"></div>
    </div>
    <p class="hint">Puoi compilare anche solo uno dei due (es. solo incassato per un acconto ricevuto oggi).</p>
    <label for="note">Nota / cliente (facoltativa)</label>
    <input id="note" maxlength="80" placeholder="es. Cliente Rossi" autocomplete="off">
    <div class="msg" id="msg"></div>
    <button type="submit" class="btn-main">Aggiungi</button>
    <div class="list">
      <h3>Inserimenti di oggi</h3>
      <div id="items"></div>
    </div>
    <a class="tv-link" href="${DASH_PATH}/tv" target="_blank">Apri la schermata della TV ↗</a>
  </form>
</div>`}

<script>
const API = '${DASH_PATH}/api';
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const $ = (id) => document.getElementById(id);
let last = null, lastListKey = null;
const anims = {};

function fmt(n) { return Number.isInteger(n) ? eur.format(n) : eur2.format(n); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function animateTo(id, from, to) {
  const el = $(id);
  cancelAnimationFrame(anims[id]);
  const start = performance.now(), dur = 1500;
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
    el.textContent = p < 1 ? eur.format(Math.round(v)) : fmt(to);
    if (p < 1) anims[id] = requestAnimationFrame(step);
  };
  anims[id] = requestAnimationFrame(step);
  if (to > from) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

function flash(text) {
  const f = $('flash');
  f.textContent = text;
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
}

function render(d) {
  $('date').textContent = new Date(d.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('count').textContent = d.count === 0 ? 'Nessuna vendita ancora' : d.count === 1 ? '1 vendita' : d.count + ' vendite';
  $('cashedSub').textContent = d.total > 0 ? Math.round(d.cashed / d.total * 100) + '% del fatturato' : '';

  if (last === null) { $('total').textContent = fmt(d.total); $('cashed').textContent = fmt(d.cashed); }
  else {
    if (d.total !== last.total) animateTo('total', last.total, d.total);
    if (d.cashed !== last.cashed) animateTo('cashed', last.cashed, d.cashed);
    // Annuncio sulla TV della nuova vendita
    const newest = d.entries[0];
    if (newest && !last.entries.some((e) => e.id === newest.id)) {
      const parts = [];
      if (newest.amount) parts.push('+ ' + fmt(newest.amount));
      if (newest.cashed) parts.push('incassati ' + fmt(newest.cashed));
      flash((newest.seller ? newest.seller + '  ' : '') + parts.join(' · '));
    }
  }

  // Classifica (ordinata per fatturato)
  const max = Math.max(1, ...d.ranking.map((r) => r.total));
  const rows = $('rows');
  if (rows.children.length !== d.ranking.length) rows.innerHTML = d.ranking.map(() =>
    '<div class="row"><span class="pos num"></span><span class="name"></span><span class="bar"><i></i></span><span class="amt num"></span></div>').join('');
  d.ranking.forEach((r, i) => {
    const row = rows.children[i];
    row.classList.toggle('first', i === 0 && r.total > 0);
    row.querySelector('.pos').textContent = (i + 1) + '°';
    row.querySelector('.name').textContent = r.name;
    row.querySelector('.bar i').style.width = (r.total / max * 100) + '%';
    row.querySelector('.amt').innerHTML = fmt(r.total) + '<small>incassato ' + fmt(r.cashed) + '</small>';
  });

  last = d;

  // Lista inserimenti (solo PC): ridisegna solo se cambiata, così il clic su "Elimina" non va perso
  const key = d.entries.map((e) => e.id).join(',');
  if (!$('items') || key === lastListKey) return;
  lastListKey = key;
  $('items').innerHTML = d.entries.length ? d.entries.map((e) =>
    '<div class="item"><span class="who">' + esc(e.seller || '—') + '</span><span class="vals">' +
    (e.amount ? '<b>' + eur2.format(e.amount) + '</b> fatt. ' : '') + (e.cashed ? '<b>' + eur2.format(e.cashed) + '</b> inc.' : '') +
    (e.note ? '<span>' + esc(e.note) + '</span>' : '') +
    '</span><span class="time">' + new Date(e.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) +
    '</span><button type="button" class="del" data-id="' + e.id + '">Elimina</button></div>'
  ).join('') : '<div class="item"><span class="vals">Nessun inserimento</span></div>';
}

async function refresh() {
  try {
    const r = await fetch(API, { cache: 'no-store' });
    if (r.status === 401) { location.reload(); return; }
    render(await r.json());
    $('status').classList.remove('offline');
  } catch (e) { $('status').classList.add('offline'); }
}

function tick() { $('clock').textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
tick(); setInterval(tick, 1000);
refresh(); setInterval(refresh, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// Evita che la TV vada in standby
async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch (e) {} }
keepAwake(); document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

// Doppio clic = schermo intero (comodo sulla TV)
$('screen').addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());

// Solo nella pagina del PC: modulo per inserire
if ($('addForm')) {
let seller = null;
$('sellers').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  seller = b.dataset.s;
  [...$('sellers').children].forEach((x) => x.classList.toggle('on', x === b));
  $('amount').focus();
};

function parseAmount(s) {
  s = s.replace(/[€\\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\\./g, '').replace(',', '.');
  else if (/^\\d{1,3}(\\.\\d{3})+$/.test(s)) s = s.replace(/\\./g, '');
  return Number(s);
}

$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!seller) { $('msg').textContent = 'Scegli il sales'; return; }
  const amount = parseAmount($('amount').value), cashed = parseAmount($('cashedIn').value);
  if (!isFinite(amount) || !isFinite(cashed)) { $('msg').textContent = 'Importo non valido'; return; }
  if (!amount && !cashed) { $('msg').textContent = 'Scrivi il fatturato o l\\'incassato'; return; }
  $('msg').textContent = 'Salvo…';
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seller, amount, cashed, note: $('note').value }) });
    if (!r.ok) throw new Error();
    render(await r.json());
    $('amount').value = ''; $('cashedIn').value = ''; $('note').value = '';
    $('msg').textContent = '✓ Aggiunto per ' + seller;
  } catch (err) { $('msg').textContent = 'Errore, riprova'; }
};

// Primo clic: "Sicuro?" — secondo clic: elimina
$('items').onclick = async (e) => {
  const btn = e.target.closest('.del');
  if (!btn) return;
  if (!btn.classList.contains('sure')) {
    btn.classList.add('sure'); btn.textContent = 'Sicuro?';
    setTimeout(() => { if (btn.isConnected && btn.textContent === 'Sicuro?') { btn.classList.remove('sure'); btn.textContent = 'Elimina'; } }, 4000);
    return;
  }
  btn.disabled = true; btn.textContent = 'Elimino…';
  try {
    const r = await fetch(API + '?id=' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
    if (!r.ok) throw new Error();
    render(await r.json());
    $('msg').textContent = '✓ Eliminato';
  } catch (err) {
    btn.disabled = false; btn.classList.remove('sure'); btn.textContent = 'Elimina';
    $('msg').textContent = 'Errore, non eliminato: riprova';
  }
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
    const date = romeDate();
    const key = `fatturato:${date}`;

    if (request.method === "GET") return json(summary(date, await readDay(kv, date)));

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const amount = round2(Number(body.amount) || 0);
      const cashed = round2(Number(body.cashed) || 0);
      const valid = (n) => isFinite(n) && Math.abs(n) <= 100000000;
      if (!valid(amount) || !valid(cashed) || (!amount && !cashed)) return json({ error: "importo non valido" }, 400);
      if (!SELLERS.includes(body.seller)) return json({ error: "sales non valido" }, 400);
      const day = await readDay(kv, date);
      day.entries.push({
        id: toHex(crypto.getRandomValues(new Uint8Array(6))),
        seller: body.seller,
        amount,
        cashed,
        note: String(body.note || "").slice(0, 80),
        ts: Date.now(),
      });
      await kv.put(key, JSON.stringify(day));
      return json(summary(date, day));
    }

    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      const day = await readDay(kv, date);
      day.entries = day.entries.filter((e) => e.id !== id);
      await kv.put(key, JSON.stringify(day));
      return json(summary(date, day));
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
