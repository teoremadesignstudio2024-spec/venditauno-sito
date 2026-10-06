// Dashboard "Fatturato del giorno" per la TV dell'ufficio.
// Pagina: /dashboardvenditatop  (sulla TV mostra il totale, dal PC si aggiunge con il tasto "+")
// I dati stanno nel KV ACADEMY_PROGRESS con chiave "fatturato:AAAA-MM-GG" (giorno di Roma).

export const DASH_PATH = "/dashboardvenditatop";

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

function summary(date, day) {
  const total = day.entries.reduce((s, e) => s + e.amount, 0);
  return {
    date,
    total: Math.round(total * 100) / 100,
    count: day.entries.length,
    entries: day.entries.slice(-8).reverse(),
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

function loginPage(error) {
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
<form method="POST" action="${DASH_PATH}/login">
  <h1>Fatturato del giorno</h1>
  ${error ? `<p class="err">${error}</p>` : ""}
  <input type="password" name="password" placeholder="Password" required autofocus autocomplete="current-password">
  <button type="submit">Entra</button>
</form>
</body>
</html>`;
}

function dashboardPage() {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Fatturato del giorno</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #000; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
  .screen { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4vh 4vw; }
  .label { font-size: clamp(1.4rem, 4.5vw, 5rem); font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
  .date { font-size: clamp(1rem, 2.2vw, 2.4rem); color: #fff; opacity: 0.7; margin-top: 1vh; text-transform: capitalize; }
  .total { font-size: clamp(3.5rem, 16vw, 22rem); font-weight: 900; line-height: 1; margin: 5vh 0 3vh; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; transition: transform 0.3s; }
  .total.bump { animation: bump 1.2s ease-out; }
  @keyframes bump { 0% { transform: scale(1); } 15% { transform: scale(1.08); } 100% { transform: scale(1); } }
  .count { font-size: clamp(1rem, 2.4vw, 2.6rem); opacity: 0.75; }
  .flash { position: fixed; left: 50%; top: 18vh; transform: translateX(-50%); font-size: clamp(1.5rem, 5vw, 6rem); font-weight: 800; opacity: 0; pointer-events: none; }
  .flash.show { animation: flash 3s ease-out; }
  @keyframes flash { 0% { opacity: 0; transform: translate(-50%, 2vh); } 12% { opacity: 1; transform: translate(-50%, 0); } 75% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -2vh); } }
  .clock { position: fixed; top: 3vh; right: 3vw; font-size: clamp(1rem, 2.4vw, 2.6rem); font-variant-numeric: tabular-nums; opacity: 0.7; }
  .status { position: fixed; bottom: 2vh; left: 3vw; font-size: 0.9rem; opacity: 0; transition: opacity 0.3s; }
  .status.offline { opacity: 0.6; }

  /* Pannello per aggiungere: visibile solo muovendo il mouse (sulla TV resta nascosto) */
  .add-btn { position: fixed; bottom: 3vh; right: 3vw; width: 64px; height: 64px; border-radius: 50%; background: #fff; color: #000; border: 0; font-size: 2.2rem; font-weight: 700; cursor: pointer; opacity: 0; transition: opacity 0.4s; }
  body.mouse .add-btn { opacity: 1; }
  .panel { position: fixed; inset: 0; background: rgba(0,0,0,0.92); display: none; align-items: center; justify-content: center; padding: 16px; z-index: 10; }
  .panel.open { display: flex; }
  .card { width: 100%; max-width: 440px; background: #000; border: 1px solid #333; border-radius: 16px; padding: 28px; }
  .card h2 { margin: 0 0 20px; font-size: 1.2rem; letter-spacing: 0.1em; text-transform: uppercase; }
  .card label { display: block; font-size: 0.85rem; opacity: 0.7; margin-bottom: 6px; }
  .card input { width: 100%; padding: 14px; font-size: 1.2rem; background: #111; color: #fff; border: 1px solid #333; border-radius: 10px; margin-bottom: 14px; }
  .card .row { display: flex; gap: 10px; }
  .card button { flex: 1; padding: 14px; font-size: 1rem; font-weight: 700; border-radius: 10px; cursor: pointer; border: 1px solid #fff; }
  .btn-main { background: #fff; color: #000; }
  .btn-ghost { background: #000; color: #fff; border-color: #444 !important; }
  .msg { min-height: 1.3em; font-size: 0.9rem; margin: 4px 0 10px; }
  .list { margin-top: 22px; border-top: 1px solid #222; padding-top: 14px; max-height: 34vh; overflow-y: auto; }
  .list h3 { margin: 0 0 10px; font-size: 0.85rem; opacity: 0.7; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
  .item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #1a1a1a; font-size: 0.95rem; }
  .item .amt { font-weight: 700; font-variant-numeric: tabular-nums; }
  .item .note { flex: 1; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .time { opacity: 0.5; font-size: 0.8rem; }
  .item .del { background: none; border: 0; color: #f87171; cursor: pointer; font-size: 1rem; padding: 4px 6px; flex: none; }
</style>
</head>
<body>
<div class="clock" id="clock"></div>
<div class="screen" id="screen">
  <div class="label">Fatturato del giorno</div>
  <div class="date" id="date"></div>
  <div class="total" id="total">€ 0</div>
  <div class="count" id="count"></div>
</div>
<div class="flash" id="flash"></div>
<div class="status" id="status">Connessione persa, riprovo…</div>

<button class="add-btn" id="addBtn" title="Aggiungi fatturato">+</button>
<div class="panel" id="panel">
  <form class="card" id="addForm">
    <h2>Aggiungi fatturato</h2>
    <label for="amount">Importo (€)</label>
    <input id="amount" inputmode="decimal" placeholder="es. 1500 oppure 1.250,50" autocomplete="off" required>
    <label for="note">Nota (facoltativa)</label>
    <input id="note" maxlength="80" placeholder="es. Cliente Rossi" autocomplete="off">
    <div class="msg" id="msg"></div>
    <div class="row">
      <button type="button" class="btn-ghost" id="closeBtn">Chiudi</button>
      <button type="submit" class="btn-main">Aggiungi</button>
    </div>
    <div class="list">
      <h3>Ultimi inserimenti di oggi</h3>
      <div id="items"></div>
    </div>
  </form>
</div>

<script>
const API = '${DASH_PATH}/api';
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const $ = (id) => document.getElementById(id);
let shown = null, lastTotal = null, anim = null;

function fmtTotal(n) { return Number.isInteger(n) ? eur.format(n) : eur2.format(n); }

function animateTo(target) {
  const from = shown ?? 0;
  if (anim) cancelAnimationFrame(anim);
  const start = performance.now(), dur = 1500;
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const v = from + (target - from) * (1 - Math.pow(1 - p, 3));
    $('total').textContent = p < 1 ? eur.format(Math.round(v)) : fmtTotal(target);
    if (p < 1) anim = requestAnimationFrame(step); else shown = target;
  };
  anim = requestAnimationFrame(step);
}

function render(d) {
  $('date').textContent = new Date(d.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('count').textContent = d.count === 0 ? 'Nessuna vendita ancora' : d.count === 1 ? '1 vendita' : d.count + ' vendite';
  if (lastTotal === null) { shown = d.total; $('total').textContent = fmtTotal(d.total); }
  else if (d.total !== lastTotal) {
    if (d.total > lastTotal) {
      const f = $('flash');
      f.textContent = '+ ' + fmtTotal(Math.round((d.total - lastTotal) * 100) / 100);
      f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
      const t = $('total'); t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump');
    }
    animateTo(d.total);
  }
  lastTotal = d.total;
  $('items').innerHTML = d.entries.length ? d.entries.map((e) =>
    '<div class="item"><span class="amt">' + eur2.format(e.amount) + '</span><span class="note">' + esc(e.note || '') +
    '</span><span class="time">' + new Date(e.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) +
    '</span><button type="button" class="del" data-id="' + e.id + '" title="Elimina">✕</button></div>'
  ).join('') : '<div class="item"><span class="note">Nessun inserimento</span></div>';
}

function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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

// Mostra il "+" solo quando si usa il mouse
let mouseTimer;
document.addEventListener('mousemove', () => {
  document.body.classList.add('mouse');
  clearTimeout(mouseTimer);
  mouseTimer = setTimeout(() => document.body.classList.remove('mouse'), 3000);
});
// Doppio clic sul totale = schermo intero (comodo sulla TV)
$('screen').addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());

function openPanel() { $('panel').classList.add('open'); $('msg').textContent = ''; $('amount').focus(); }
function closePanel() { $('panel').classList.remove('open'); }
$('addBtn').onclick = openPanel;
$('closeBtn').onclick = closePanel;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
  else if (!$('panel').classList.contains('open') && (e.key === '+' || /^[0-9]$/.test(e.key))) {
    openPanel(); if (/^[0-9]$/.test(e.key)) { $('amount').value = e.key; e.preventDefault(); }
  }
});

function parseAmount(s) {
  s = s.replace(/[€\\s]/g, '');
  if (s.includes(',')) s = s.replace(/\\./g, '').replace(',', '.');
  else if (/^\\d{1,3}(\\.\\d{3})+$/.test(s)) s = s.replace(/\\./g, '');
  return Number(s);
}

$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  const amount = parseAmount($('amount').value);
  if (!isFinite(amount) || amount === 0) { $('msg').textContent = 'Importo non valido'; return; }
  $('msg').textContent = 'Salvo…';
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, note: $('note').value }) });
    if (!r.ok) throw new Error();
    render(await r.json());
    $('amount').value = ''; $('note').value = '';
    $('msg').textContent = '✓ Aggiunto ' + eur2.format(amount);
    $('amount').focus();
  } catch (err) { $('msg').textContent = 'Errore, riprova'; }
};

$('items').onclick = async (e) => {
  const id = e.target.dataset?.id;
  if (!id || !confirm('Eliminare questo inserimento?')) return;
  const r = await fetch(API + '?id=' + encodeURIComponent(id), { method: 'DELETE' });
  if (r.ok) render(await r.json());
};
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
        Location: DASH_PATH,
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
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!isFinite(amount) || amount === 0 || Math.abs(amount) > 100000000) return json({ error: "importo non valido" }, 400);
      const day = await readDay(kv, date);
      day.entries.push({
        id: toHex(crypto.getRandomValues(new Uint8Array(6))),
        amount,
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
    return html(loggedIn ? dashboardPage() : loginPage(null));
  }

  return new Response(null, { status: 302, headers: { Location: DASH_PATH } });
}
