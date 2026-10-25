// Dashboard vendite Vendita Uno.
// Pagine: /dashboardvenditatop = gestionale per i venditori (clienti, onboarding, live, upsell, calendario)
//         /tv                  = schermata per la TV dell'ufficio (incassato, podio, obiettivo, banner)
// Tutti i dati stanno in un'unica chiave del KV ACADEMY_PROGRESS: "crm:v1".

export const DASH_PATH = "/dashboardvenditatop";
export const TV_PATH = "/tv";

// Password di accesso: salvata solo come hash PBKDF2. Per cambiarla chiedi a Claude un nuovo hash.
const DASH_SALT = "dc9c1720bf64430ece096b2650befaac";
const DASH_HASH = "ac7f198145ddd36f9805c116254d3ae88b0df25100e68c158b521ae2c62d4db8";
const DASH_COOKIE = "vu_dash_session";
const DASH_SESSION_DAYS = 365;

const STATE_KEY = "crm:v1";
const VERSION = "v5"; // si vede in alto nella dashboard: serve a capire quale versione è online

// Regole del percorso cliente
const CONFIG = {
  frontAmount: 200,        // acconto del nuovo cliente (vendita telefonica)
  upsellAmount: 2500,      // upsell della live del venerdì
  upsellMonths: 3,         // durata del servizio gestito dopo l'upsell
  sessions: {
    tue: "Tutorial Portafoglio Business",
    thu: "Sessione del giovedì (anti-spam Facebook)",
    fri: "Live upsell del venerdì",
  },
};

const DEFAULT_QUOTES = [
  "Ogni no ti avvicina al prossimo sì.",
  "Chi chiama di più, incassa di più.",
  "Il cliente non compra il prodotto, compra la tua sicurezza.",
  "Disciplina batte talento quando il talento non ha disciplina.",
  "Oggi è un buon giorno per battere il record.",
  "Una chiamata in più può cambiare il mese.",
  "Non si vende al telefono: si aiuta. L'incasso è la conseguenza.",
  "Il follow-up è dove si fanno i soldi.",
];

// ---------- Utilità date (usate anche nel browser) ----------

function addDays(d, n) {
  const t = new Date(d + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function weekday(d) {
  return new Date(d + "T12:00:00Z").getUTCDay();
}
function nextWeekday(d, wd) {
  let x = addDays(d, 1);
  while (weekday(x) !== wd) x = addDays(x, 1);
  return x;
}
function addMonths(d, n) {
  const t = new Date(d + "T12:00:00Z");
  const day = t.getUTCDate();
  t.setUTCDate(1);
  t.setUTCMonth(t.getUTCMonth() + n);
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
// Primo martedì dopo l'entrata, poi giovedì e venerdì della stessa settimana
function schedule(created) {
  const tue = nextWeekday(created, 2);
  return { tue, thu: addDays(tue, 2), fri: addDays(tue, 3) };
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function sumAmounts(list) {
  return round2(list.reduce((s, p) => s + (p.amount || 0), 0));
}
// Quanto resta da incassare dell'upsell chiuso
function toCollect(c) {
  if (c.upsell.status !== "chiuso") return 0;
  const paid = sumAmounts(c.payments.filter((p) => p.kind !== "acconto"));
  return Math.max(0, round2((c.upsell.amount || 0) - paid));
}
// In che colonna della pipeline sta il cliente
function stageOf(c, today) {
  const u = c.upsell;
  if (u.status === "chiuso") return u.end && u.end < today ? "scaduto" : "gestito";
  if (u.status === "richiamare") return "richiamare";
  if (u.status === "non_chiuso" || c.imported) return "lifetime";
  if (c.onb.tue.present === true && c.onb.thu.present === true) return "live";
  return "onboarding";
}

const SHARED = [addDays, weekday, nextWeekday, addMonths, schedule, round2, sumAmounts, toCollect, stageOf]
  .map((f) => f.toString()).join("\n");

// ---------- Server ----------

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const newId = () => toHex(crypto.getRandomValues(new Uint8Array(6)));

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

async function readState(kv) {
  const raw = await kv.get(STATE_KEY);
  const s = raw ? JSON.parse(raw) : {};
  const state = {
    sellers: s.sellers || [],
    clients: s.clients || [],
    goals: s.goals || {},
    quotes: s.quotes || DEFAULT_QUOTES,
    news: s.news || [],
    legacyImported: !!s.legacyImported,
  };
  if (!state.legacyImported) {
    try {
      await importLegacy(kv, state);
      await kv.put(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      // Se l'importazione non riesce la dashboard funziona lo stesso; riprova alla prossima apertura
      state.importError = String(e && e.message || e);
    }
  }
  return state;
}

// Una sola volta: porta qui le vendite della dashboard di prima (chiavi "fatturato:AAAA-MM-GG").
async function importLegacy(kv, state) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: "fatturato:", cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const seen = new Set();
  for (const key of keys.sort()) {
    const date = key.slice("fatturato:".length);
    if (!isDate(date)) continue;
    const day = JSON.parse((await kv.get(key)) || "{}");
    for (const e of day.entries || []) {
      if (state.clients.some((c) => c.legacyId === e.id)) continue;
      const who = e.seller || "Senza venditore";
      seen.add(who);
      const sched = schedule(date);
      const cashed = round2(Number(e.cashed) || 0);
      const billed = round2(Number(e.amount) || 0);
      state.clients.push({
        id: newId(), legacyId: e.id, imported: true,
        name: str(e.note, 80) || `Vendita di ${who}`, phone: "", email: "", seller: who, created: date,
        notes: `Importato dalla dashboard di prima: fatturato ${billed} €, incassato ${cashed} €.`,
        onb: { tue: { date: sched.tue, present: null }, thu: { date: sched.thu, present: null } },
        live: { date: sched.fri, invited: false, present: null },
        upsell: { status: null, amount: CONFIG.upsellAmount, date: null, start: null, end: null, recall: null },
        payments: cashed > 0 ? [{ id: newId(), date, amount: cashed, seller: who, kind: "acconto", note: "importato", ts: e.ts || 0 }] : [],
      });
    }
  }
  // Se i venditori non sono ancora stati scritti, si parte da quelli delle vendite importate (Elio non c'è più)
  if (!state.sellers.length) state.sellers = [...seen].filter((n) => n !== "Elio" && n !== "Senza venditore");
  state.legacyImported = true;
}

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v, max = 120) => String(v ?? "").trim().slice(0, max);
const tri = (v) => (v === true ? true : v === false ? false : null);
function money(v, { allowZero = false } = {}) {
  const n = round2(Number(v));
  if (!isFinite(n) || n < 0 || n > 1e8 || (!allowZero && n === 0)) throw new Error("Importo non valido");
  return n;
}

function applyOp(state, op, today) {
  const find = (id) => {
    const c = state.clients.find((x) => x.id === id);
    if (!c) throw new Error("Cliente non trovato");
    return c;
  };
  // Accetta un venditore della lista, oppure quello già salvato (anche se poi è stato tolto)
  const seller = (s, current) => {
    if (s === current || state.sellers.includes(s)) return s;
    throw new Error("Scegli il venditore");
  };
  const KINDS = ["acconto", "upsell", "saldo"];

  switch (op.op) {
    case "setSellers": {
      const list = [...new Set((op.sellers || []).map((s) => str(s, 30)).filter(Boolean))];
      if (!list.length) throw new Error("Serve almeno un venditore");
      state.sellers = list;
      return;
    }
    case "setGoal": {
      const month = /^\d{4}-\d{2}$/.test(op.month) ? op.month : today.slice(0, 7);
      state.goals[month] = { target: money(op.target, { allowZero: true }), bonus: money(op.bonus, { allowZero: true }) };
      return;
    }
    case "setTicker": {
      state.quotes = (op.quotes || []).map((q) => str(q, 160)).filter(Boolean).slice(0, 50);
      state.news = (op.news || []).map((q) => str(q, 160)).filter(Boolean).slice(0, 20);
      return;
    }
    case "addClient": {
      const name = str(op.name, 80);
      if (!name) throw new Error("Scrivi il nome del cliente");
      const date = isDate(op.date) ? op.date : today;
      const who = seller(op.seller);
      const amount = op.amount === undefined || op.amount === "" ? CONFIG.frontAmount : money(op.amount, { allowZero: true });
      const s = schedule(date);
      const c = {
        id: newId(), name, phone: str(op.phone, 40), email: str(op.email, 120), seller: who, created: date,
        notes: str(op.notes, 2000),
        onb: { tue: { date: s.tue, present: null }, thu: { date: s.thu, present: null } },
        live: { date: s.fri, invited: false, present: null },
        upsell: { status: null, amount: CONFIG.upsellAmount, date: null, start: null, end: null, recall: null },
        payments: [],
      };
      if (amount) c.payments.push({ id: newId(), date, amount, seller: who, kind: "acconto", note: "", ts: Date.now() });
      state.clients.push(c);
      return c.id;
    }
    case "updateClient": {
      const c = find(op.id);
      const f = op.fields || {};
      if ("name" in f) {
        const n = str(f.name, 80);
        if (!n) throw new Error("Il nome non può essere vuoto");
        c.name = n;
      }
      if ("phone" in f) c.phone = str(f.phone, 40);
      if ("email" in f) c.email = str(f.email, 120);
      if ("notes" in f) c.notes = str(f.notes, 2000);
      if ("seller" in f) c.seller = seller(f.seller, c.seller);
      if (isDate(f.created)) c.created = f.created;
      for (const k of ["tue", "thu"]) {
        if (!f[k]) continue;
        if (isDate(f[k].date)) c.onb[k].date = f[k].date;
        if ("present" in f[k]) c.onb[k].present = tri(f[k].present);
      }
      if (f.live) {
        if (isDate(f.live.date)) c.live.date = f.live.date;
        if ("invited" in f.live) c.live.invited = !!f.live.invited;
        if ("present" in f.live) c.live.present = tri(f.live.present);
      }
      if (f.upsell) {
        const u = f.upsell;
        if ("status" in u) {
          if (![null, "chiuso", "non_chiuso", "richiamare"].includes(u.status)) throw new Error("Esito non valido");
          c.upsell.status = u.status;
          if (u.status === "chiuso" && !c.upsell.start) {
            c.upsell.date = c.upsell.date || today;
            c.upsell.start = c.upsell.date;
            c.upsell.end = addMonths(c.upsell.start, CONFIG.upsellMonths);
          }
        }
        if ("amount" in u) c.upsell.amount = money(u.amount, { allowZero: true });
        if (isDate(u.date)) c.upsell.date = u.date;
        if (isDate(u.start)) {
          c.upsell.start = u.start;
          c.upsell.end = addMonths(u.start, CONFIG.upsellMonths);
        }
        if (isDate(u.end)) c.upsell.end = u.end;
        if ("recall" in u) c.upsell.recall = isDate(u.recall) ? u.recall : null;
      }
      return;
    }
    case "deleteClient": {
      find(op.id);
      state.clients = state.clients.filter((x) => x.id !== op.id);
      return;
    }
    case "addPayment": {
      const c = find(op.clientId);
      c.payments.push({
        id: newId(),
        date: isDate(op.date) ? op.date : today,
        amount: money(op.amount),
        seller: seller(op.seller || c.seller, c.seller),
        kind: KINDS.includes(op.kind) ? op.kind : "saldo",
        note: str(op.note, 120),
        ts: Date.now(),
      });
      return;
    }
    case "updatePayment": {
      const c = find(op.clientId);
      const p = c.payments.find((x) => x.id === op.paymentId);
      if (!p) throw new Error("Pagamento non trovato");
      const f = op.fields || {};
      if ("amount" in f) p.amount = money(f.amount);
      if (isDate(f.date)) p.date = f.date;
      if ("seller" in f) p.seller = seller(f.seller, p.seller);
      if (KINDS.includes(f.kind)) p.kind = f.kind;
      if ("note" in f) p.note = str(f.note, 120);
      return;
    }
    case "deletePayment": {
      const c = find(op.clientId);
      c.payments = c.payments.filter((x) => x.id !== op.paymentId);
      return;
    }
    default:
      throw new Error("Operazione sconosciuta");
  }
}

const fmtEur = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const fmtDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// Riepilogo per la TV (e per la testata del gestionale)
function tvSummary(state, today) {
  const month = today.slice(0, 7);
  const pays = state.clients.flatMap((c) => c.payments.map((p) => ({ ...p, client: c.name })));
  const monthPays = pays.filter((p) => p.date.startsWith(month));
  const dayPays = pays.filter((p) => p.date === today);
  const goal = state.goals[month] || { target: 0, bonus: 0 };

  // Chi ha raggiunto per primo l'obiettivo: si ripercorrono gli incassi del mese in ordine
  let winner = null;
  if (goal.target > 0) {
    const run = {};
    for (const p of monthPays.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0))) {
      run[p.seller] = (run[p.seller] || 0) + p.amount;
      if (run[p.seller] >= goal.target && state.sellers.includes(p.seller)) { winner = { name: p.seller, date: p.date }; break; }
    }
  }

  const ranking = state.sellers.map((name) => ({
    name,
    month: sumAmounts(monthPays.filter((p) => p.seller === name)),
    today: sumAmounts(dayPays.filter((p) => p.seller === name)),
    newClients: state.clients.filter((c) => c.seller === name && c.created.startsWith(month)).length,
  })).sort((a, b) => b.month - a.month || b.today - a.today);

  // Prossime sessioni (martedì, giovedì, venerdì) con quanti clienti sono attesi
  const lives = [
    ["tue", (c) => c.onb.tue.date, 2],
    ["thu", (c) => c.onb.thu.date, 4],
    ["fri", (c) => c.live.date, 5],
  ].map(([type, get, wd]) => {
    const date = weekday(today) === wd ? today : nextWeekday(today, wd);
    return { type, label: CONFIG.sessions[type], date, count: state.clients.filter((c) => get(c) === date).length };
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Banner: news, promemoria automatici e frasi motivazionali
  const reminders = [];
  for (const l of lives) {
    if (!l.count) continue;
    if (l.date === today) reminders.push(`📅 Oggi: ${l.label} con ${l.count} ${l.count === 1 ? "cliente" : "clienti"}`);
    else if (l.date === addDays(today, 1)) reminders.push(`📅 Domani: ${l.label} con ${l.count} ${l.count === 1 ? "cliente" : "clienti"} — mandate il link!`);
  }
  for (const c of state.clients) {
    if (c.upsell.status === "richiamare" && (!c.upsell.recall || c.upsell.recall <= today)) reminders.push(`📞 Da richiamare: ${c.name} (${c.seller})`);
    const due = toCollect(c);
    if (due > 0) reminders.push(`💶 Da incassare: ${c.name} — ${fmtEur(due)} (${c.seller})`);
    if (c.upsell.status === "chiuso" && c.upsell.end && c.upsell.end >= today && c.upsell.end <= addDays(today, 30)) reminders.push(`⏰ ${c.name} scade ${fmtDay(c.upsell.end)}: proponete il rinnovo`);
  }
  if (goal.target > 0 && !winner) {
    for (const r of ranking) if (r.month < goal.target) reminders.push(`🎯 ${r.name}: mancano ${fmtEur(goal.target - r.month)} all'obiettivo${goal.bonus ? ` — bonus ${fmtEur(goal.bonus)} al primo!` : ""}`);
  }
  const ticker = [...state.news.map((n) => `📢 ${n}`), ...reminders.slice(0, 20), ...state.quotes.map((q) => `💪 ${q}`)];

  const last = pays.filter((p) => p.ts).sort((a, b) => b.ts - a.ts)[0];
  return {
    today,
    cashedToday: sumAmounts(dayPays),
    cashedMonth: sumAmounts(monthPays),
    newToday: state.clients.filter((c) => c.created === today).length,
    newMonth: state.clients.filter((c) => c.created.startsWith(month)).length,
    upsellMonth: state.clients.filter((c) => c.upsell.status === "chiuso" && (c.upsell.date || "").startsWith(month)).length,
    goal, winner, ranking, lives, ticker,
    last: last ? { id: last.id, seller: last.seller, amount: last.amount, kind: last.kind } : null,
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
<title>Dashboard vendite — Accedi</title>
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
  <h1>Dashboard vendite</h1>
  ${error ? `<p class="err">${error}</p>` : ""}
  <input type="password" name="password" placeholder="Password" required autofocus autocomplete="current-password">
  <button type="submit">Entra</button>
</form>
</body>
</html>`;
}

// ---------- Pagina TV ----------

function tvPage() {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Vendite — TV</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #000; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
  .num { font-variant-numeric: tabular-nums; }
  .screen { height: 100vh; display: flex; flex-direction: column; padding: 2.5vh 3.5vw 0; gap: 2vh; }
  .top { display: flex; justify-content: space-between; align-items: baseline; font-size: clamp(0.9rem, 1.9vw, 2.2rem); opacity: 0.75; }
  .top .date { text-transform: capitalize; }
  .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 3vw; text-align: center; }
  .kpi .label { font-size: clamp(0.9rem, 2vw, 2.4rem); font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; white-space: nowrap; }
  .kpi .value { font-size: clamp(2.2rem, 6.6vw, 8.5rem); font-weight: 900; line-height: 1.05; margin-top: 0.6vh; letter-spacing: -0.02em; }
  .kpi .sub { font-size: clamp(0.8rem, 1.4vw, 1.7rem); opacity: 0.6; margin-top: 0.4vh; }
  .bump { animation: bump 1.2s ease-out; }
  @keyframes bump { 0% { transform: scale(1); } 15% { transform: scale(1.08); } 100% { transform: scale(1); } }

  .bottom { flex: 1; min-height: 0; display: grid; grid-template-columns: 2.2fr 1fr; gap: 3vw; border-top: 1px solid #333; padding-top: 2vh; }
  .podium-wrap { display: flex; flex-direction: column; min-height: 0; }
  h2 { margin: 0 0 0.6vh; font-size: clamp(1rem, 2.2vw, 2.6rem); font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; text-align: center; }
  .goal { text-align: center; font-size: clamp(0.8rem, 1.5vw, 1.8rem); opacity: 0.8; }
  .goal b { color: #ffd54a; }
  .podium { flex: 1; display: flex; align-items: flex-end; justify-content: center; gap: 1.2vw; min-height: 0; }
  .step { flex: 1; max-width: 22vw; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; text-align: center; }
  .step[hidden] { display: none; }
  .step .medal { font-size: clamp(1.4rem, 3.2vw, 4rem); line-height: 1; }
  .step .name { font-size: clamp(1.1rem, 2.6vw, 3.2rem); font-weight: 900; margin-top: 0.4vh; }
  .step .amt { font-size: clamp(1rem, 2.4vw, 3rem); font-weight: 900; color: #4ade80; }
  .step .inc { font-size: clamp(0.7rem, 1.2vw, 1.4rem); opacity: 0.65; }
  .bar { width: 80%; height: 0.9vh; min-height: 5px; background: #222; border-radius: 99px; overflow: hidden; margin: 0.8vh 0 1vh; }
  .bar i { display: block; height: 100%; width: 0; background: #ffd54a; border-radius: 99px; transition: width 1.2s ease-out; }
  .step .block { width: 100%; border-radius: 1.2vw 1.2vw 0 0; display: flex; align-items: flex-start; justify-content: center; padding-top: 1.2vh;
    font-size: clamp(1.4rem, 3.2vw, 4rem); line-height: 1; font-weight: 900; color: rgba(0,0,0,0.75); }
  .p1 .block { height: 16vh; background: linear-gradient(180deg, #ffe17a, #d4a017 55%, #8a6a0c); box-shadow: 0 0 4vw rgba(255, 205, 60, 0.35); }
  .p2 .block { height: 11vh; background: linear-gradient(180deg, #f2f2f2, #b8b8b8 55%, #6d6d6d); }
  .p3 .block { height: 7.5vh; background: linear-gradient(180deg, #f0b27a, #c7792f 55%, #6e3f14); }
  .step.pop .name, .step.pop .medal { animation: pop 1.2s ease-out; }
  @keyframes pop { 0% { transform: scale(1); } 20% { transform: scale(1.25); } 100% { transform: scale(1); } }

  .side { display: flex; flex-direction: column; gap: 2vh; min-height: 0; border-left: 1px solid #222; padding-left: 2.5vw; }
  .side h3 { margin: 0 0 1vh; font-size: clamp(0.8rem, 1.4vw, 1.7rem); font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.6; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 1vw; padding: 0.9vh 0; border-bottom: 1px solid #1a1a1a; font-size: clamp(0.9rem, 1.7vw, 2rem); }
  .row .l { font-weight: 700; }
  .row .l small { display: block; font-weight: 400; opacity: 0.55; font-size: 0.7em; text-transform: capitalize; }
  .row .r { font-weight: 900; }
  .winner { background: #1a1503; border: 1px solid #ffd54a; border-radius: 1vw; padding: 1.2vh 1vw; text-align: center; font-size: clamp(0.9rem, 1.7vw, 2rem); font-weight: 800; }

  .ticker { height: 6.5vh; min-height: 34px; border-top: 1px solid #333; overflow: hidden; display: flex; align-items: center; white-space: nowrap; font-size: clamp(0.9rem, 2vw, 2.4rem); font-weight: 600; }
  .ticker .track { display: inline-block; padding-left: 100%; animation: scroll linear infinite; }
  .ticker .track span { margin-right: 6vw; }
  @keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

  .flash { position: fixed; left: 50%; top: 38vh; transform: translateX(-50%); font-size: clamp(1.5rem, 5vw, 6rem); font-weight: 900; opacity: 0; pointer-events: none; background: #000; padding: 0.25em 0.7em; border: 3px solid #4ade80; border-radius: 0.4em; white-space: nowrap; }
  .flash.show { animation: flash 4s ease-out; }
  @keyframes flash { 0% { opacity: 0; transform: translate(-50%, 2vh) scale(0.9); } 10% { opacity: 1; transform: translate(-50%, 0) scale(1); } 85% { opacity: 1; } 100% { opacity: 0; } }
  .status { position: fixed; top: 1vh; left: 50%; transform: translateX(-50%); font-size: 0.9rem; opacity: 0; }
  .status.offline { opacity: 0.6; }

  @media (max-width: 700px) {
    html, body { overflow: auto; height: auto; }
    .screen { height: auto; }
    .kpis, .bottom { grid-template-columns: 1fr; }
    .side { border-left: 0; padding-left: 0; }
    .step { max-width: none; }
    .p1 .block { height: 90px; } .p2 .block { height: 65px; } .p3 .block { height: 45px; }
    .podium { flex: none; margin-top: 2vh; }
  }
</style>
</head>
<body>
<div class="screen" id="screen">
  <div class="top"><span class="date" id="date"></span><span class="num" id="clock"></span></div>
  <div class="kpis">
    <div class="kpi"><div class="label">Incassato di oggi</div><div class="value num" id="cashedToday">0 €</div><div class="sub" id="todaySub"></div></div>
    <div class="kpi"><div class="label">Incassato del mese</div><div class="value num" id="cashedMonth">0 €</div><div class="sub" id="monthSub"></div></div>
  </div>
  <div class="bottom">
    <div class="podium-wrap">
      <h2>🏆 Top venditore</h2>
      <div class="goal" id="goal"></div>
      <div class="podium" id="podium">
        <div class="step p2" id="p2"><div class="medal">🥈</div><div class="name"></div><div class="amt num"></div><div class="inc num"></div><div class="bar"><i></i></div><div class="block">2</div></div>
        <div class="step p1" id="p1"><div class="medal">👑</div><div class="name"></div><div class="amt num"></div><div class="inc num"></div><div class="bar"><i></i></div><div class="block">1</div></div>
        <div class="step p3" id="p3"><div class="medal">🥉</div><div class="name"></div><div class="amt num"></div><div class="inc num"></div><div class="bar"><i></i></div><div class="block">3</div></div>
      </div>
    </div>
    <div class="side">
      <div id="winnerBox"></div>
      <div><h3>Prossime live</h3><div id="lives"></div></div>
      <div id="othersBox"></div>
    </div>
  </div>
  <div class="ticker"><div class="track" id="track"></div></div>
</div>
<div class="flash" id="flash"></div>
<div class="status" id="status">Connessione persa, riprovo…</div>
<script>
// Il bundler di Cloudflare aggiunge __name(...) alle funzioni: nel browser non esiste, quindi lo definiamo.
var __name = (f) => f;
// Se qualcosa va storto, l'errore si vede sullo schermo (così basta una foto per capire il problema)
function showError(msg) {
  var b = document.getElementById("errbox");
  if (!b) { b = document.createElement("div"); b.id = "errbox"; b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99;background:#7f1d1d;color:#fff;padding:12px 14px;border-radius:10px;font:14px system-ui;white-space:pre-wrap"; document.body.appendChild(b); }
  b.textContent = "⚠️ " + msg + "  (${VERSION})";
}
window.addEventListener("error", function (e) { showError("Errore: " + e.message + (e.lineno ? " — riga " + e.lineno : "")); });
window.addEventListener("unhandledrejection", function (e) { showError("Errore: " + (e.reason && e.reason.message || e.reason)); });
const API = ${JSON.stringify(DASH_PATH + "/api/tv")};
${SHARED}
(${tvMain.toString()})();
</script>
</body>
</html>`;
}

// Codice della TV (gira nel browser)
function tvMain() {
  const $ = (id) => document.getElementById(id);
  const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const eur2 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
  const fmt = (n) => (Number.isInteger(n) ? eur.format(n) : eur2.format(n));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dayLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  let last = null, tickerKey = "";
  const anims = {};

  function animateTo(id, from, to) {
    const el = $(id);
    cancelAnimationFrame(anims[id]);
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / 1500);
      el.textContent = p < 1 ? eur.format(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)))) : fmt(to);
      if (p < 1) anims[id] = requestAnimationFrame(step);
    };
    anims[id] = requestAnimationFrame(step);
    if (to > from) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  }

  // Annunci in coda, uno alla volta
  const queue = [];
  let flashing = false;
  function flash(text) {
    queue.push(text);
    if (flashing) return;
    const next = () => {
      const t = queue.shift();
      if (!t) { flashing = false; return; }
      flashing = true;
      const f = $("flash");
      f.textContent = t;
      f.classList.remove("show"); void f.offsetWidth; f.classList.add("show");
      setTimeout(next, 4100);
    };
    next();
  }

  function render(d) {
    $("date").textContent = dayLabel(d.today);
    const plural = (n, a, b) => n + " " + (n === 1 ? a : b);
    $("todaySub").textContent = plural(d.newToday, "nuovo cliente", "nuovi clienti") + " oggi";
    $("monthSub").textContent = plural(d.newMonth, "nuovo cliente", "nuovi clienti") + " · " + d.upsellMonth + " upsell nel mese";

    if (!last) { $("cashedToday").textContent = fmt(d.cashedToday); $("cashedMonth").textContent = fmt(d.cashedMonth); }
    else {
      if (d.cashedToday !== last.cashedToday) animateTo("cashedToday", last.cashedToday, d.cashedToday);
      if (d.cashedMonth !== last.cashedMonth) animateTo("cashedMonth", last.cashedMonth, d.cashedMonth);
      if (d.last && (!last.last || d.last.id !== last.last.id)) {
        const k = d.last.kind;
        flash((k === "acconto" ? "🎉 Nuovo cliente! " : k === "upsell" ? "⭐ Upsell chiuso! " : "💶 Incasso! ") + d.last.seller + " +" + fmt(d.last.amount));
      }
      if (d.winner && !last.winner) flash("🏆 " + d.winner.name + " ha raggiunto l'obiettivo!");
      if (d.ranking[0] && last.ranking[0] && d.ranking[0].month > 0 && d.ranking[0].name !== last.ranking[0].name) flash("👑 " + d.ranking[0].name + " passa in testa!");
    }

    // Obiettivo del mese
    const g = d.goal;
    $("goal").innerHTML = g.target > 0
      ? "Obiettivo del mese: <b>" + fmt(g.target) + "</b> di incassato a testa" + (g.bonus ? " · bonus <b>" + fmt(g.bonus) + "</b> al primo che ci arriva" : "")
      : "Incassato del mese";

    // Podio (fino a 3 venditori); la barra è l'avanzamento verso l'obiettivo
    const max = g.target > 0 ? g.target : Math.max(1, ...d.ranking.map((r) => r.month));
    [1, 2, 3].forEach((pos) => {
      const r = d.ranking[pos - 1], step = $("p" + pos);
      step.hidden = !r;
      if (!r) return;
      const changed = last && last.ranking[pos - 1] && last.ranking[pos - 1].name !== r.name;
      step.querySelector(".name").textContent = r.name;
      step.querySelector(".amt").textContent = fmt(r.month);
      step.querySelector(".inc").textContent = "oggi " + fmt(r.today) + (g.target > 0 ? " · " + Math.min(100, Math.round(r.month / g.target * 100)) + "% obiettivo" : "");
      step.querySelector(".bar i").style.width = Math.min(100, r.month / max * 100) + "%";
      if (changed) { step.classList.remove("pop"); void step.offsetWidth; step.classList.add("pop"); }
    });

    $("winnerBox").innerHTML = !d.winner ? ""
      : '<div class="winner">🏆 ' + esc(d.winner.name) + (g.bonus ? " ha vinto il bonus di " + fmt(g.bonus) + "!" : " ha raggiunto l'obiettivo!") + "</div>";
    $("lives").innerHTML = d.lives.map((l) =>
      '<div class="row"><span class="l">' + esc(l.label) + "<small>" + (l.date === d.today ? "oggi" : esc(dayLabel(l.date))) + '</small></span><span class="r num">' + l.count + "</span></div>").join("");
    const rest = d.ranking.slice(3);
    $("othersBox").innerHTML = rest.length ? "<h3>Fuori dal podio</h3>" + rest.map((r, i) =>
      '<div class="row"><span class="l">' + (i + 4) + "° " + esc(r.name) + '</span><span class="r num">' + fmt(r.month) + "</span></div>").join("") : "";

    // Banner che scorre: si rigenera solo se cambia il testo, così non riparte da capo
    const key = d.ticker.join("|");
    if (key !== tickerKey) {
      tickerKey = key;
      const track = $("track");
      track.innerHTML = d.ticker.map((t) => "<span>" + esc(t) + "</span>").join("");
      track.style.animationDuration = Math.max(30, key.length / 9) + "s";
    }
    last = d;
  }

  async function refresh() {
    try {
      const r = await fetch(API, { cache: "no-store" });
      if (r.status === 401) { location.reload(); return; }
      const text = await r.text();
      if (!r.ok) { showError("Il server ha risposto " + r.status + ": " + text.slice(0, 300)); return; }
      render(JSON.parse(text));
      $("status").classList.remove("offline");
    } catch (e) { $("status").classList.add("offline"); }
  }
  async function keepAwake() { try { await navigator.wakeLock?.request("screen"); } catch (e) {} }
  const tick = () => { $("clock").textContent = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); };
  tick(); setInterval(tick, 1000);
  refresh(); setInterval(refresh, 5000);
  keepAwake();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); keepAwake(); } });
  $("screen").addEventListener("dblclick", () => document.documentElement.requestFullscreen?.());
}

// ---------- Gestionale per i venditori ----------

function appPage() {
  return `<!DOCTYPE html>
<html lang="it">
<head>
${BASE_HEAD}
<title>Dashboard vendite</title>
<style>
  * { box-sizing: border-box; }
  :root { --bg: #000; --card: #0e0e0e; --line: #262626; --muted: #9a9a9a; --green: #4ade80; --gold: #ffd54a; --red: #f87171; --blue: #60a5fa; }
  body { margin: 0; background: var(--bg); color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 15px; }
  button, input, select, textarea { font: inherit; color: inherit; }
  input, select, textarea { width: 100%; padding: 10px 12px; background: #141414; border: 1px solid #333; border-radius: 9px; }
  input[type=date] { color-scheme: dark; }
  textarea { min-height: 80px; resize: vertical; }
  label { display: block; font-size: 0.8rem; color: var(--muted); margin: 10px 0 5px; }
  .btn { padding: 10px 16px; border-radius: 9px; border: 1px solid #333; background: #141414; cursor: pointer; font-weight: 700; white-space: nowrap; }
  .btn:hover { border-color: #555; }
  .btn.main { background: #fff; color: #000; border-color: #fff; }
  .btn.green { background: var(--green); color: #000; border-color: var(--green); }
  .btn.danger { color: var(--red); border-color: #5b1d1d; background: none; }
  .btn.danger.sure { background: #dc2626; color: #fff; border-color: #dc2626; }
  .btn.sm { padding: 6px 10px; font-size: 0.85rem; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }

  header { position: sticky; top: 0; z-index: 5; background: rgba(0,0,0,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
  .hrow { max-width: 1280px; margin: 0 auto; padding: 12px 16px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .brand { font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.95rem; }
  .kpis { display: flex; gap: 18px; flex-wrap: wrap; margin-left: auto; }
  .kpis div { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .kpis b { display: block; color: #fff; font-size: 1.15rem; letter-spacing: 0; }
  .kpis b.g { color: var(--green); }
  nav { max-width: 1280px; margin: 0 auto; padding: 0 16px; display: flex; gap: 4px; overflow-x: auto; }
  nav button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 10px 12px; cursor: pointer; color: var(--muted); font-weight: 700; white-space: nowrap; }
  nav button.on { color: #fff; border-color: #fff; }
  main { max-width: 1280px; margin: 0 auto; padding: 18px 16px 60px; }
  h2 { font-size: 1.05rem; margin: 22px 0 10px; letter-spacing: 0.04em; }
  .card h2 { margin-top: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .item { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #1b1b1b; }
  .item:last-child { border-bottom: 0; }
  .item .grow { flex: 1; min-width: 0; }
  .item .grow small { display: block; color: var(--muted); font-size: 0.8rem; }
  .link { cursor: pointer; text-decoration: underline; text-decoration-color: #444; text-underline-offset: 3px; }
  .tag { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: #1f1f1f; color: #ccc; }
  .tag.g { background: #0f2a18; color: var(--green); } .tag.y { background: #2a2207; color: var(--gold); } .tag.r { background: #2a0f0f; color: var(--red); }
  .empty { color: var(--muted); font-size: 0.9rem; padding: 6px 0; }

  .pipe { display: grid; grid-template-columns: repeat(6, minmax(220px, 1fr)); gap: 10px; overflow-x: auto; padding-bottom: 8px; }
  .col { background: #070707; border: 1px solid var(--line); border-radius: 12px; padding: 10px; min-height: 120px; }
  .col h3 { margin: 2px 4px 10px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); display: flex; justify-content: space-between; }
  .cc { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px; margin-bottom: 8px; cursor: pointer; }
  .cc:hover { border-color: #555; }
  .cc b { display: block; }
  .cc small { color: var(--muted); font-size: 0.78rem; }

  .cal-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .cal-head b { font-size: 1.1rem; text-transform: capitalize; min-width: 170px; text-align: center; }
  .cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
  .cal .dow { font-size: 0.75rem; color: var(--muted); text-align: center; padding: 4px 0; text-transform: uppercase; }
  .day { background: var(--card); border: 1px solid var(--line); border-radius: 8px; min-height: 96px; padding: 6px; font-size: 0.78rem; overflow: hidden; }
  .day.out { opacity: 0.35; }
  .day.today { border-color: #fff; }
  .day .n { font-weight: 800; margin-bottom: 4px; }
  .ev { display: block; padding: 2px 5px; border-radius: 5px; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; background: #1a1a1a; }
  .ev.s { background: #0d1d33; color: var(--blue); font-weight: 700; }
  .ev.f { background: #2a2207; color: var(--gold); font-weight: 700; }

  .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: none; align-items: flex-start; justify-content: center; padding: 30px 12px; overflow-y: auto; z-index: 20; }
  .modal-bg.open { display: flex; }
  .modal { width: 100%; max-width: 720px; background: #0a0a0a; border: 1px solid #333; border-radius: 16px; padding: 20px; }
  .modal h3 { margin: 0 0 4px; font-size: 1.25rem; }
  .sec { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 12px; }
  .sec h4 { margin: 0 0 6px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .three { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .seg { display: inline-flex; border: 1px solid #333; border-radius: 9px; overflow: hidden; flex-wrap: wrap; }
  .seg button { background: #141414; border: 0; border-right: 1px solid #333; padding: 8px 12px; cursor: pointer; font-weight: 700; color: var(--muted); }
  .seg button:last-child { border-right: 0; }
  .seg button.on { background: #fff; color: #000; }
  .prow { display: grid; grid-template-columns: 140px 110px 1fr 120px auto; gap: 6px; align-items: center; margin-bottom: 6px; }
  .actions { display: flex; gap: 8px; justify-content: space-between; margin-top: 18px; flex-wrap: wrap; }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #fff; color: #000; font-weight: 700; padding: 12px 18px; border-radius: 10px; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 30; }
  .toast.show { opacity: 1; }
  .toast.err { background: var(--red); }
  .who { display: flex; align-items: center; gap: 8px; }
  .who select { width: auto; padding: 6px 10px; }
  @media (max-width: 640px) {
    .two, .three { grid-template-columns: 1fr; }
    .prow { grid-template-columns: 1fr 1fr; }
    .day { min-height: 70px; font-size: 0.68rem; padding: 4px; }
    .kpis { margin-left: 0; }
  }
</style>
</head>
<body>
<header>
  <div class="hrow">
    <span class="brand">Vendita Uno · Vendite <small style="opacity:.4;font-weight:400;letter-spacing:0">${VERSION}</small></span>
    <div class="who">Io sono <select id="me"></select></div>
    <button class="btn main" id="newBtn">+ Nuovo cliente</button>
    <div class="kpis">
      <div>Incassato oggi<b class="num g" id="kToday">—</b></div>
      <div>Incassato mese<b class="num g" id="kMonth">—</b></div>
      <div>Nuovi oggi<b class="num" id="kNew">—</b></div>
      <div>Mio obiettivo<b class="num" id="kGoal">—</b></div>
    </div>
  </div>
  <nav id="tabs">
    <button data-t="oggi" class="on">Oggi</button>
    <button data-t="clienti">Clienti</button>
    <button data-t="calendario">Calendario</button>
    <button data-t="impostazioni">Venditori, obiettivo e TV</button>
    <button onclick="window.open('${TV_PATH}','_blank')">Apri la TV ↗</button>
  </nav>
</header>
<main id="main"></main>
<div class="modal-bg" id="modalBg"><div class="modal" id="modal"></div></div>
<div class="toast" id="toast"></div>
<script>
// Il bundler di Cloudflare aggiunge __name(...) alle funzioni: nel browser non esiste, quindi lo definiamo.
var __name = (f) => f;
// Se qualcosa va storto, l'errore si vede sullo schermo (così basta una foto per capire il problema)
function showError(msg) {
  var b = document.getElementById("errbox");
  if (!b) { b = document.createElement("div"); b.id = "errbox"; b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99;background:#7f1d1d;color:#fff;padding:12px 14px;border-radius:10px;font:14px system-ui;white-space:pre-wrap"; document.body.appendChild(b); }
  b.textContent = "⚠️ " + msg + "  (${VERSION})";
}
window.addEventListener("error", function (e) { showError("Errore: " + e.message + (e.lineno ? " — riga " + e.lineno : "")); });
window.addEventListener("unhandledrejection", function (e) { showError("Errore: " + (e.reason && e.reason.message || e.reason)); });
const API = ${JSON.stringify(DASH_PATH + "/api")};
const CONFIG = ${JSON.stringify(CONFIG)};
${SHARED}
(${appMain.toString()})();
</script>
</body>
</html>`;
}

// Codice del gestionale (gira nel browser)
function appMain() {
  const $ = (id) => document.getElementById(id);
  const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const eur2 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
  const fmt = (n) => (Number.isInteger(n) ? eur.format(n) : eur2.format(n));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dShort = (d) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "—";
  const STAGES = [
    ["onboarding", "Onboarding"], ["live", "Pronti per la live"], ["richiamare", "Da richiamare"],
    ["gestito", "Gestiti (3 mesi)"], ["lifetime", "Lifetime (no upsell)"], ["scaduto", "Scaduti"],
  ];
  const KIND = { acconto: "Acconto", upsell: "Upsell", saldo: "Saldo/rata" };
  let S = null, tab = "oggi", calMonth = null, open = null, search = "";

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const me = () => { const m = lsGet("vu_me"); return S && S.state.sellers.includes(m) ? m : (S && S.state.sellers[0]) || ""; };

  function toast(msg, err) {
    const t = $("toast");
    t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function load() {
    try {
      const r = await fetch(API + "/state", { cache: "no-store" });
      if (r.status === 401) { location.reload(); return; }
      const text = await r.text();
      if (!r.ok) { showError("Il server ha risposto " + r.status + ": " + text.slice(0, 300)); return; }
      S = JSON.parse(text);
      render();
      const eb = document.getElementById("errbox");
      if (S.state.importError) showError("Importazione clienti di prima non riuscita: " + S.state.importError);
      else if (eb) eb.remove();
    } catch (e) { showError("Caricamento non riuscito: " + (e.message || e)); }
  }
  async function op(body, okMsg) {
    let d;
    try {
      const r = await fetch(API + "/op", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      d = await r.json();
      if (!r.ok) throw new Error(d.error || "Errore");
    } catch (e) { toast(e.message || "Errore, riprova", true); throw e; }
    S = d;
    render(true);
    if (okMsg) toast(okMsg);
    return d;
  }

  const client = (id) => S.state.clients.find((c) => c.id === id);
  const sellerOpts = (sel) => {
    const list = !sel || S.state.sellers.includes(sel) ? S.state.sellers : [...S.state.sellers, sel];
    return list.map((s) => `<option ${s === sel ? "selected" : ""}>${esc(s)}</option>`).join("");
  };
  const paid = (c) => sumAmounts(c.payments);
  function parseAmount(s) {
    s = String(s || "").replace(/[€\s]/g, "");
    if (!s) return 0;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    return Number(s);
  }

  // ---- testata ----
  function renderHeader() {
    const t = S.tv;
    $("kToday").textContent = fmt(t.cashedToday);
    $("kMonth").textContent = fmt(t.cashedMonth);
    $("kNew").textContent = t.newToday;
    const mine = t.ranking.find((r) => r.name === me());
    $("kGoal").textContent = t.goal.target > 0 ? fmt(mine ? mine.month : 0) + " / " + fmt(t.goal.target) : "da impostare";
    const sel = $("me");
    sel.innerHTML = S.state.sellers.map((s) => `<option ${s === me() ? "selected" : ""}>${esc(s)}</option>`).join("");
    sel.onchange = () => { lsSet("vu_me", sel.value); render(true); };
    document.querySelectorAll("#tabs button[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
  }

  // ---- tab Oggi ----
  const sessionClients = (type, date) => S.state.clients.filter((c) => (type === "fri" ? c.live.date : c.onb[type].date) === date);
  function renderToday() {
    const today = S.tv.today, C = S.state.clients;
    const row = (c, extra) => `<div class="item"><div class="grow"><span class="link" data-open="${c.id}">${esc(c.name)}</span><small>${esc(c.seller)} · ${esc(c.phone || "nessun telefono")}</small></div>${extra || ""}</div>`;
    const block = (title, items) => `<div class="card"><h2>${title}</h2>${items.length ? items.join("") : '<div class="empty">Niente da fare qui 👌</div>'}</div>`;

    const recall = C.filter((c) => c.upsell.status === "richiamare" && (!c.upsell.recall || c.upsell.recall <= today))
      .map((c) => row(c, `<span class="tag y">${c.upsell.recall ? esc(dShort(c.upsell.recall)) : "subito"}</span>`));
    const missed = C.filter((c) => !c.upsell.status && !c.imported && ["tue", "thu"].some((k) => c.onb[k].date < today && c.onb[k].present !== true))
      .map((c) => row(c, `<span class="tag r">onboarding saltato</span>`));
    const collect = C.filter((c) => toCollect(c) > 0).map((c) => row(c, `<span class="tag y num">${fmt(toCollect(c))}</span>`));
    const expiring = C.filter((c) => c.upsell.status === "chiuso" && c.upsell.end && c.upsell.end <= addDays(today, 30))
      .map((c) => row(c, `<span class="tag ${c.upsell.end < today ? "r" : "y"}">${c.upsell.end < today ? "scaduto" : "scade"} ${esc(dShort(c.upsell.end))}</span>`));

    $("main").innerHTML = `
      <h2>Prossime sessioni</h2>
      <div class="grid">${S.tv.lives.map((l) => `<div class="card"><div class="item"><div class="grow"><b>${esc(l.label)}</b><small>${l.date === today ? "oggi" : esc(dShort(l.date))} · ${l.count} ${l.count === 1 ? "cliente" : "clienti"}</small></div>
        <button class="btn sm" data-presence="${l.type}|${l.date}">Presenze</button></div></div>`).join("")}</div>
      <div class="grid" style="margin-top:12px">
        ${block("📞 Da richiamare", recall)}
        ${block("⚠️ Onboarding da recuperare", missed)}
        ${block("💶 Da incassare", collect)}
        ${block("⏰ In scadenza (rinnovo)", expiring)}
      </div>
      <h2>Classifica del mese (incassato)</h2>
      <div class="card">${S.tv.ranking.map((r, i) => `<div class="item"><div class="grow"><b>${i + 1}° ${esc(r.name)}</b><small>oggi ${fmt(r.today)} · ${r.newClients} nuovi clienti</small></div><b class="num" style="color:var(--green)">${fmt(r.month)}</b></div>`).join("")}</div>`;
  }

  // ---- tab Clienti (pipeline) ----
  function renderClients() {
    const today = S.tv.today;
    const q = search.toLowerCase();
    const C = S.state.clients.filter((c) => !q || [c.name, c.phone, c.email, c.seller].join(" ").toLowerCase().includes(q));
    const card = (c) => {
      const due = toCollect(c), st = stageOf(c, today);
      let info = "entrato " + dShort(c.created);
      if (st === "onboarding") info = dShort(c.onb.tue.date) + (c.onb.tue.present ? " ✓" : "") + " · " + dShort(c.onb.thu.date) + (c.onb.thu.present ? " ✓" : "");
      if (st === "live") info = "live " + dShort(c.live.date) + (c.live.invited ? " · link mandato" : "");
      if (st === "richiamare") info = "richiamare " + (c.upsell.recall ? dShort(c.upsell.recall) : "subito");
      if (st === "gestito" || st === "scaduto") info = "scade " + dShort(c.upsell.end);
      return `<div class="cc" data-open="${c.id}"><b>${esc(c.name)}</b><small>${esc(c.seller)} · ${esc(info)}</small>
        <div style="margin-top:6px"><span class="tag g num">${fmt(paid(c))}</span>${due ? ` <span class="tag y num">da incassare ${fmt(due)}</span>` : ""}</div></div>`;
    };
    $("main").innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap"><input id="search" placeholder="Cerca cliente, telefono, email, venditore…" value="${esc(search)}" style="max-width:420px"><span class="muted" style="align-self:center">${S.state.clients.length} clienti</span></div>
      <div class="pipe">${STAGES.map(([k, label]) => {
        const list = C.filter((c) => stageOf(c, today) === k).sort((a, b) => b.created.localeCompare(a.created));
        return `<div class="col"><h3><span>${label}</span><span>${list.length}</span></h3>${list.map(card).join("") || '<div class="empty">—</div>'}</div>`;
      }).join("")}</div>`;
    const s = $("search");
    s.oninput = () => { search = s.value; const pos = s.selectionStart; renderClients(); const n = $("search"); n.focus(); n.setSelectionRange(pos, pos); };
  }

  // ---- tab Calendario ----
  function renderCalendar() {
    const today = S.tv.today;
    calMonth = calMonth || today.slice(0, 7);
    const first = calMonth + "-01";
    let start = first;
    while (weekday(start) !== 1) start = addDays(start, -1);
    const events = {}, sessions = {};
    const add = (d, h) => { (events[d] = events[d] || []).push(h); };
    for (const c of S.state.clients) {
      for (const [type, d] of [["tue", c.onb.tue.date], ["thu", c.onb.thu.date], ["fri", c.live.date]]) {
        const k = type + "|" + d; sessions[k] = (sessions[k] || 0) + 1;
      }
      add(c.created, `<span class="ev" data-open="${c.id}">🟢 ${esc(c.name)}</span>`);
      if (c.upsell.status === "chiuso" && c.upsell.date) add(c.upsell.date, `<span class="ev" data-open="${c.id}">⭐ ${esc(c.name)}</span>`);
      if (c.upsell.status === "chiuso" && c.upsell.end) add(c.upsell.end, `<span class="ev" data-open="${c.id}">⏰ ${esc(c.name)} scade</span>`);
      if (c.upsell.status === "richiamare" && c.upsell.recall) add(c.upsell.recall, `<span class="ev" data-open="${c.id}">📞 ${esc(c.name)}</span>`);
    }
    const short = { tue: "📘 Tutorial", thu: "📗 Giovedì", fri: "🎥 Live upsell" };
    for (const k in sessions) {
      const [type, d] = k.split("|");
      (events[d] = events[d] || []).unshift(`<span class="ev ${type === "fri" ? "f" : "s"}" data-presence="${k}">${short[type]} · ${sessions[k]}</span>`);
    }
    let cells = "";
    for (let i = 0, d = start; i < 42; i++, d = addDays(d, 1)) {
      if (i === 35 && !d.startsWith(calMonth)) break;
      cells += `<div class="day ${d.startsWith(calMonth) ? "" : "out"} ${d === today ? "today" : ""}"><div class="n">${Number(d.slice(8))}</div>${(events[d] || []).join("")}</div>`;
    }
    const title = new Date(first + "T12:00:00Z").toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
    $("main").innerHTML = `
      <div class="cal-head"><button class="btn sm" id="calPrev">‹</button><b>${title}</b><button class="btn sm" id="calNext">›</button><button class="btn sm" id="calToday">Oggi</button>
        <span class="muted" style="margin-left:auto;font-size:0.85rem">🟢 entrato · ⭐ upsell · ⏰ scadenza · 📞 richiamo · clicca una sessione per le presenze</span></div>
      <div class="cal">${["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((x) => `<div class="dow">${x}</div>`).join("")}${cells}</div>`;
    const shift = (n) => { calMonth = addMonths(calMonth + "-01", n).slice(0, 7); renderCalendar(); };
    $("calPrev").onclick = () => shift(-1);
    $("calNext").onclick = () => shift(1);
    $("calToday").onclick = () => { calMonth = today.slice(0, 7); renderCalendar(); };
  }

  // ---- tab Venditori, obiettivo e TV ----
  function renderSettings() {
    const month = S.tv.today.slice(0, 7);
    const g = S.state.goals[month] || { target: 0, bonus: 0 };
    const monthName = new Date(month + "-01T12:00:00Z").toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
    $("main").innerHTML = `
      <div class="grid">
        <div class="card"><h2>👥 Venditori</h2>
          <p class="muted" style="margin-top:0">Uno per riga. Chi non lavora più va tolto: i suoi incassi passati restano.</p>
          <textarea id="sellers" style="min-height:120px" placeholder="es.&#10;Samuele&#10;Tomas">${esc(S.state.sellers.join("\n"))}</textarea>
          <div style="margin-top:10px"><button class="btn main" id="saveSellers">Salva venditori</button></div></div>
        <div class="card"><h2>🎯 Obiettivo di ${esc(monthName)}</h2>
          <p class="muted" style="margin-top:0">Incassato da raggiungere a testa. Il primo che ci arriva vince il bonus (si vede sulla TV).</p>
          <div class="two"><div><label>Obiettivo (€ a testa)</label><input id="goalT" inputmode="decimal" value="${g.target || ""}" placeholder="es. 3000"></div>
          <div><label>Bonus al primo (€)</label><input id="goalB" inputmode="decimal" value="${g.bonus || ""}" placeholder="es. 200"></div></div>
          <div style="margin-top:10px"><button class="btn main" id="saveGoal">Salva obiettivo</button></div></div>
        <div class="card"><h2>📢 News e avvisi per la TV</h2>
          <p class="muted" style="margin-top:0">Scorrono nel banner in basso sulla TV. Uno per riga: cancellali quando non servono più.</p>
          <textarea id="news" placeholder="es. Venerdì live speciale alle 18:00">${esc(S.state.news.join("\n"))}</textarea>
          <label>💪 Frasi motivazionali (una per riga)</label>
          <textarea id="quotes" style="min-height:160px">${esc(S.state.quotes.join("\n"))}</textarea>
          <div style="margin-top:10px"><button class="btn main" id="saveTicker">Salva banner</button></div>
          <p class="muted" style="font-size:0.8rem">I promemoria (da richiamare, da incassare, live di domani, quanto manca all'obiettivo) si aggiungono da soli.</p></div>
      </div>`;
    const lines = (id) => $(id).value.split("\n").map((s) => s.trim()).filter(Boolean);
    $("saveSellers").onclick = () => op({ op: "setSellers", sellers: lines("sellers") }, "Venditori salvati");
    $("saveGoal").onclick = () => op({ op: "setGoal", month, target: parseAmount($("goalT").value) || 0, bonus: parseAmount($("goalB").value) || 0 }, "Obiettivo salvato");
    $("saveTicker").onclick = () => op({ op: "setTicker", news: lines("news"), quotes: lines("quotes") }, "Banner salvato");
  }

  // ---- finestre ----
  function openModal(h) { $("modal").innerHTML = h; $("modalBg").classList.add("open"); }
  function closeModal() { $("modalBg").classList.remove("open"); open = null; }
  $("modalBg").onclick = (e) => { if (e.target === $("modalBg")) closeModal(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  const twoClick = (b, label) => { if (b.classList.contains("sure")) return true; b.classList.add("sure"); b.textContent = label; return false; };

  function newClientModal() {
    if (!S.state.sellers.length) { tab = "impostazioni"; render(true); toast("Prima scrivi i nomi dei venditori", true); return; }
    open = { type: "new" };
    openModal(`<h3>🎉 Nuovo cliente</h3><p class="muted" style="margin:0">Vendita telefonica con acconto. Lo metto in automatico nel prossimo martedì, giovedì e live del venerdì.</p>
      <div class="two"><div><label>Nome e cognome *</label><input id="nName" autocomplete="off"></div><div><label>Telefono</label><input id="nPhone" inputmode="tel" autocomplete="off"></div></div>
      <div class="two"><div><label>Email</label><input id="nEmail" inputmode="email" autocomplete="off"></div><div><label>Venditore</label><select id="nSeller">${sellerOpts(me())}</select></div></div>
      <div class="two"><div><label>Incassato ora (€)</label><input id="nAmount" inputmode="decimal" value="${CONFIG.frontAmount}"></div><div><label>Data</label><input id="nDate" type="date" value="${S.tv.today}"></div></div>
      <label>Note</label><textarea id="nNotes" placeholder="es. attività, città, come ci ha conosciuto"></textarea>
      <div class="actions"><button class="btn" id="nCancel">Annulla</button><button class="btn green" id="nSave">Registra cliente</button></div>`);
    $("nName").focus();
    $("nCancel").onclick = closeModal;
    $("nSave").onclick = async () => {
      await op({ op: "addClient", name: $("nName").value, phone: $("nPhone").value, email: $("nEmail").value, seller: $("nSeller").value,
        amount: parseAmount($("nAmount").value), date: $("nDate").value, notes: $("nNotes").value }, "🎉 Cliente registrato");
      closeModal();
    };
  }

  const segBtns = (name, value, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) =>
    `<button type="button" data-v="${v}" class="${String(value) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const triVal = (v) => (v === "true" ? true : v === "false" ? false : null);
  const segVal = (name) => { const b = document.querySelector(`#modal [data-seg="${name}"] .on`); return b ? b.dataset.v : "null"; };

  function clientModal(id) {
    const c = client(id);
    if (!c) { closeModal(); return; }
    open = { type: "client", id };
    const u = c.upsell, due = toCollect(c);
    const presence = [["null", "—"], ["true", "Presente"], ["false", "Assente"]];
    const kindDefault = u.status === "chiuso" ? (c.payments.some((p) => p.kind === "upsell") ? "saldo" : "upsell") : "acconto";
    openModal(`
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3>${esc(c.name)}</h3>
        <span class="muted">Entrato ${esc(dShort(c.created))} · incassato <b class="num" style="color:var(--green)">${fmt(paid(c))}</b>${due ? ` · da incassare <b class="num" style="color:var(--gold)">${fmt(due)}</b>` : ""}</span></div>
        <button class="btn sm" id="cClose">✕</button></div>
      <div class="sec"><h4>Dati</h4>
        <div class="two"><div><label>Nome</label><input id="cName" value="${esc(c.name)}"></div><div><label>Venditore</label><select id="cSeller">${sellerOpts(c.seller)}</select></div></div>
        <div class="three"><div><label>Telefono</label><input id="cPhone" value="${esc(c.phone)}"></div><div><label>Email</label><input id="cEmail" value="${esc(c.email)}"></div><div><label>Data entrata</label><input id="cCreated" type="date" value="${c.created}"></div></div>
        <label>Note</label><textarea id="cNotes">${esc(c.notes)}</textarea></div>
      <div class="sec"><h4>Onboarding</h4>
        <div class="two"><div><label>📘 ${esc(CONFIG.sessions.tue)}</label><input id="cTue" type="date" value="${c.onb.tue.date}"><div style="margin-top:6px">${segBtns("tue", c.onb.tue.present, presence)}</div></div>
        <div><label>📗 ${esc(CONFIG.sessions.thu)}</label><input id="cThu" type="date" value="${c.onb.thu.date}"><div style="margin-top:6px">${segBtns("thu", c.onb.thu.present, presence)}</div></div></div></div>
      <div class="sec"><h4>🎥 Live del venerdì</h4>
        <div class="two"><div><label>Data live</label><input id="cLive" type="date" value="${c.live.date}"></div>
        <div><label>Link della live mandato</label>${segBtns("invited", c.live.invited, [["false", "No"], ["true", "Sì"]])}</div></div>
        <label>Presenza</label>${segBtns("livep", c.live.present, presence)}</div>
      <div class="sec"><h4>⭐ Upsell (${fmt(CONFIG.upsellAmount)} · ${CONFIG.upsellMonths} mesi)</h4>
        ${segBtns("status", u.status, [["null", "—"], ["chiuso", "Chiuso"], ["richiamare", "Da richiamare"], ["non_chiuso", "Non chiuso"]])}
        <div class="three"><div><label>Importo upsell (€)</label><input id="uAmount" inputmode="decimal" value="${u.amount}"></div>
          <div><label>Inizio servizio</label><input id="uStart" type="date" value="${u.start || ""}"></div>
          <div><label>Scadenza</label><input id="uEnd" type="date" value="${u.end || ""}"></div></div>
        <div class="two"><div><label>Richiamare il</label><input id="uRecall" type="date" value="${u.recall || ""}"></div></div></div>
      <div class="sec"><h4>💶 Incassi (chi l'ha incassato conta per la classifica)</h4>
        ${c.payments.map((p) => `<div class="prow" data-pay="${p.id}">
          <input type="date" data-f="date" value="${p.date}"><input data-f="amount" inputmode="decimal" value="${p.amount}">
          <select data-f="seller">${sellerOpts(p.seller)}</select>
          <select data-f="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === p.kind ? "selected" : ""}>${l}</option>`).join("")}</select>
          <button class="btn danger sm" data-delpay="${p.id}">Elimina</button></div>`).join("") || '<div class="empty">Nessun incasso</div>'}
        <div class="prow" style="margin-top:10px"><input type="date" id="pDate" value="${S.tv.today}"><input id="pAmount" inputmode="decimal" placeholder="Importo €" value="${due || ""}">
          <select id="pSeller">${sellerOpts(c.seller)}</select>
          <select id="pKind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === kindDefault ? "selected" : ""}>${l}</option>`).join("")}</select>
          <button class="btn green sm" id="pAdd">+ Aggiungi</button></div></div>
      <div class="actions"><button class="btn danger" id="cDel">Elimina cliente</button><button class="btn main" id="cSave">Salva</button></div>`);

    document.querySelectorAll("#modal [data-seg]").forEach((g) => g.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
    $("cClose").onclick = closeModal;
    const fields = () => {
      const status = segVal("status");
      return {
        name: $("cName").value, seller: $("cSeller").value, phone: $("cPhone").value, email: $("cEmail").value, created: $("cCreated").value, notes: $("cNotes").value,
        tue: { date: $("cTue").value, present: triVal(segVal("tue")) }, thu: { date: $("cThu").value, present: triVal(segVal("thu")) },
        live: { date: $("cLive").value, invited: segVal("invited") === "true", present: triVal(segVal("livep")) },
        upsell: { status: status === "null" ? null : status, amount: parseAmount($("uAmount").value), recall: $("uRecall").value || null,
          ...($("uStart").value && $("uStart").value !== (u.start || "") ? { start: $("uStart").value } : {}),
          ...($("uEnd").value && $("uEnd").value !== (u.end || "") ? { end: $("uEnd").value } : {}) },
      };
    };
    $("cSave").onclick = async () => {
      await op({ op: "updateClient", id, fields: fields() }, "Salvato");
      closeModal();
    };
    $("cDel").onclick = async (e) => {
      if (!twoClick(e.currentTarget, "Sicuro? Clicca ancora")) return;
      await op({ op: "deleteClient", id }, "Cliente eliminato");
      closeModal();
    };
    $("pAdd").onclick = async () => {
      // Salva anche le modifiche fatte sopra, così non si perdono
      await op({ op: "updateClient", id, fields: fields() });
      await op({ op: "addPayment", clientId: id, date: $("pDate").value, amount: parseAmount($("pAmount").value), seller: $("pSeller").value, kind: $("pKind").value }, "Incasso aggiunto");
      clientModal(id);
    };
    document.querySelectorAll("#modal [data-pay]").forEach((row) => row.onchange = async (e) => {
      const f = e.target.dataset.f; if (!f) return;
      const v = f === "amount" ? parseAmount(e.target.value) : e.target.value;
      await op({ op: "updatePayment", clientId: id, paymentId: row.dataset.pay, fields: { [f]: v } }, "Incasso aggiornato");
    });
    document.querySelectorAll("#modal [data-delpay]").forEach((b) => b.onclick = async () => {
      if (!twoClick(b, "Sicuro?")) return;
      await op({ op: "deletePayment", clientId: id, paymentId: b.dataset.delpay }, "Incasso eliminato");
      clientModal(id);
    });
  }

  // Presenze di una sessione: si spuntano durante la videochiamata
  function presenceModal(type, date) {
    open = { type: "presence" };
    const list = sessionClients(type, date);
    const pv = (c) => (type === "fri" ? c.live.present : c.onb[type].present);
    openModal(`<div style="display:flex;justify-content:space-between;gap:10px"><div><h3>${esc(CONFIG.sessions[type])}</h3><span class="muted">${esc(dShort(date))} · ${list.length} clienti</span></div><button class="btn sm" id="pClose">✕</button></div>
      <div class="sec">${list.map((c) => `<div class="item"><div class="grow"><span class="link" data-open="${c.id}">${esc(c.name)}</span><small>${esc(c.phone || "")}${c.email ? " · " + esc(c.email) : ""} · ${esc(c.seller)}</small></div>
        ${type === "fri" ? `<button class="btn sm ${c.live.invited ? "green" : ""}" data-inv="${c.id}">${c.live.invited ? "Link mandato ✓" : "Link mandato?"}</button>` : ""}
        <div class="seg" data-pres="${c.id}">${[["true", "Presente"], ["false", "Assente"]].map(([v, l]) => `<button data-v="${v}" class="${String(pv(c)) === v ? "on" : ""}">${l}</button>`).join("")}</div></div>`).join("") || '<div class="empty">Nessun cliente in questa sessione</div>'}</div>`);
    $("pClose").onclick = closeModal;
    document.querySelectorAll("#modal [data-pres]").forEach((g) => g.onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const c = client(g.dataset.pres);
      const val = String(pv(c)) === b.dataset.v ? null : b.dataset.v === "true";
      await op({ op: "updateClient", id: c.id, fields: type === "fri" ? { live: { present: val } } : { [type]: { present: val } } });
      presenceModal(type, date);
    });
    document.querySelectorAll("#modal [data-inv]").forEach((b) => b.onclick = async () => {
      const c = client(b.dataset.inv);
      await op({ op: "updateClient", id: c.id, fields: { live: { invited: !c.live.invited } } });
      presenceModal(type, date);
    });
  }

  // Click globali: apri cliente / presenze
  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]");
    if (o) { clientModal(o.dataset.open); return; }
    const p = e.target.closest("[data-presence]");
    if (p) { const [t, d] = p.dataset.presence.split("|"); presenceModal(t, d); }
  });
  $("tabs").onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) { tab = b.dataset.t; render(true); } };
  $("newBtn").onclick = newClientModal;

  let welcomed = false;
  function render(force) {
    if (!S) return;
    if (!S.state.sellers.length) tab = "impostazioni";
    renderHeader();
    // L'aggiornamento automatico non ridisegna mentre si scrive in un campo
    const a = document.activeElement;
    const typing = a && $("main").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
    if (force || !typing) ({ oggi: renderToday, clienti: renderClients, calendario: renderCalendar, impostazioni: renderSettings })[tab]();
    if (!S.state.sellers.length && !welcomed) { welcomed = true; toast("Benvenuto! Scrivi i nomi dei venditori e salva"); }
  }

  load();
  // Aggiorna i dati ogni 20 secondi (se nessuna finestra è aperta)
  setInterval(() => { if (!open && !document.hidden) load(); }, 20000);
}

// ---------- Router ----------

async function handleApi(request, kv, url, path) {
  const today = romeDate();
  const state = await readState(kv);
  const full = () => json({ state, tv: tvSummary(state, today) });

  if (path === `${DASH_PATH}/api/tv` && request.method === "GET") return json(tvSummary(state, today));
  if (path === `${DASH_PATH}/api/state` && request.method === "GET") return full();
  if (path === `${DASH_PATH}/api/op` && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      applyOp(state, body, today);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    await kv.put(STATE_KEY, JSON.stringify(state));
    return full();
  }
  return json({ error: "not found" }, 404);
}


export async function handleDashboard(request, env, url) {
  const kv = env.ACADEMY_PROGRESS;
  if (!kv) return new Response("KV not configured", { status: 500 });
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === `${DASH_PATH}/login` && request.method === "POST") {
    const tv = !!url.searchParams.get("tv");
    const form = await request.formData();
    const ok = await checkDashPassword((form.get("password") || "").toString());
    if (!ok) return html(loginPage("Password non corretta.", tv));
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await kv.put(`dashsess:${token}`, "1", { expirationTtl: DASH_SESSION_DAYS * 86400 });
    return new Response(null, {
      status: 302,
      headers: {
        Location: tv ? TV_PATH : DASH_PATH,
        "Set-Cookie": `${DASH_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DASH_SESSION_DAYS * 86400}`,
      },
    });
  }

  const loggedIn = await isLoggedIn(request, kv);

  if (path.startsWith(`${DASH_PATH}/api/`)) {
    if (!loggedIn) return json({ error: "unauthorized" }, 401);
    try {
      return await handleApi(request, kv, url, path);
    } catch (e) {
      return json({ error: "Errore del server: " + (e && e.stack || e) }, 500);
    }
  }

  if (path === DASH_PATH || path === `${DASH_PATH}/login`) {
    return html(loggedIn ? appPage() : loginPage(null));
  }

  if (path === `${DASH_PATH}/tv`) return new Response(null, { status: 302, headers: { Location: TV_PATH } });

  if (path === TV_PATH) return html(loggedIn ? tvPage() : loginPage(null, true));

  return new Response(null, { status: 302, headers: { Location: DASH_PATH } });
}
