// Dashboard soldi/lead per l'ufficio (e per la TV), stile Liquid Glass con Napoleone di sfondo.
// Pagine: /dashboardvenditatop    = PC
//         /dashboardvenditatop/tv = TV, tutto in uno schermo (anche /tv)
// Tutti i numeri arrivano da GoHighLevel (vedi readGHL e readAds): niente inserimenti a mano.
// Il KV ACADEMY_PROGRESS serve solo per le sessioni di accesso.

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

const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

// GoHighLevel, sotto-account Vendita Uno. Il token è il segreto GHL_TOKEN del worker (Private Integration).
const GHL_API = "https://services.leadconnectorhq.com";
const GHL_LOCATION = "5Rz7mxEzHiMRzNoYTcXD";
const GHL_PIPELINE = "muKtKFvxMNIqxHkKrmDt"; // VENDITA PIPELINE: l'unica che si guarda (lead, chiamate, demo, vinte)
// Fasi della VENDITA PIPELINE mostrate in tabella, nell'ordine di GoHighLevel (da NUOVI LEAD a DEMO FISSATA).
// recall = da richiamare (soldi da prendere). I nomi si prendono da GoHighLevel, questi servono di riserva.
const GHL_STAGES = [
  { id: "f852ed7f-e8c1-47ed-93fb-f08c32c28814", name: "NUOVI LEAD", toCall: true },
  { id: "499bfa5d-13a7-4ef1-9471-ad90f1177d3f", name: "NR 1", recall: true },
  { id: "348bef16-a14d-47d9-b500-89376bf97036", name: "NR 2", recall: true },
  { id: "195cae2f-ee26-4f35-a9d4-7ff60ed68ff4", name: "NR 3", recall: true },
  { id: "a1ff2013-67fe-4ad2-9d44-bc9e4ead3656", name: "CHIAMATO MA NON POTEVA RICHIAMARE", recall: true },
  { id: "dd5a6442-809e-4bc6-adac-cc3fcc6694c5", name: "NO SHOW DISCO", recall: true },
  { id: "8068e5d9-d1b9-488c-a9bf-108447133504", name: "DISCO FISSATA" },
  { id: "79808f73-52c0-4221-a8e0-9caedb29fa41", name: "NO SHOW DEMO", recall: true },
  { id: "f529954b-d016-4d25-8269-0b96bfd84b77", name: "DEMO FISSATA" },
];

async function ghl(env, path) {
  const r = await fetch(GHL_API + path, {
    headers: { Authorization: `Bearer ${env.GHL_TOKEN}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`GoHighLevel ${r.status}`);
  return r.json();
}
const oppSearch = (extra) => `/opportunities/search?location_id=${GHL_LOCATION}${extra}`;
const inPipeline = `&pipeline_id=${GHL_PIPELINE}`;

// Scorre le pagine (100 alla volta, dalla più nuova); stop(opp) dice quando fermarsi.
async function allOpps(env, extra, stop = () => false) {
  const out = [];
  let after = "";
  for (let i = 0; i < 30; i++) {
    const d = await ghl(env, oppSearch(`${extra}&limit=100${after}`));
    const list = d.opportunities || [];
    out.push(...list);
    const last = list[list.length - 1];
    if (!last || !d.meta || !d.meta.nextPage || stop(last)) break;
    after = `&startAfter=${d.meta.startAfter}&startAfterId=${d.meta.startAfterId}`;
  }
  return out;
}

// Risposte tenute 20 secondi (venditori e nomi delle fasi un'ora): TV e PC aggiornano spesso e GoHighLevel ha dei limiti.
let ghlCache = { at: 0, data: null };
let ghlUsers = { at: 0, map: {} };
let ghlStageNames = { at: 0, map: {} };

async function readGHL(env) {
  if (ghlCache.data && Date.now() - ghlCache.at < 20000) return ghlCache.data;
  const usersP = Date.now() - ghlUsers.at < 3600000 ? Promise.resolve(ghlUsers.map)
    : ghl(env, `/users/?locationId=${GHL_LOCATION}`).then((d) => {
      const map = {};
      for (const u of d.users || []) map[u.id] = titleCase(String(u.firstName || u.name || "").trim());
      ghlUsers = { at: Date.now(), map };
      return map;
    }).catch(() => ghlUsers.map);
  const namesP = Date.now() - ghlStageNames.at < 3600000 ? Promise.resolve(ghlStageNames.map)
    : ghl(env, `/opportunities/pipelines?locationId=${GHL_LOCATION}`).then((d) => {
      const map = {};
      for (const p of d.pipelines || []) if (p.id === GHL_PIPELINE) for (const st of p.stages || []) map[st.id] = String(st.name || "").trim();
      ghlStageNames = { at: Date.now(), map };
      return map;
    }).catch(() => ghlStageNames.map);
  // Tutta la VENDITA PIPELINE in una lettura: da qui lead per giorno, vinte e tabella delle fasi.
  // Le altre pipeline non si guardano: un cliente spostato in "Clienti Attivi pro" esce dai conti.
  const [opps, users, stageNames] = await Promise.all([allOpps(env, inPipeline), usersP, namesP]);
  const who = (o) => String((o.contact && o.contact.name) || o.name || "").trim().slice(0, 80);
  const now = Date.now();

  // Lead arrivati: opportunità per giorno di creazione (ora di Roma).
  const leadsByDay = {};
  for (const o of opps) {
    const day = ROME_DAY.format(new Date(o.createdAt));
    leadsByDay[day] = (leadsByDay[day] || 0) + 1;
  }

  // Incassato: opportunità vinte (status won), al giorno in cui sono diventate vinte.
  const wonByDay = {};
  for (const o of opps) {
    if (o.status !== "won") continue;
    const at = o.lastStatusChangeAt || o.updatedAt || o.createdAt;
    const w = { id: String(o.id), name: who(o), amount: num(Number(o.monetaryValue) || 0), ts: Date.parse(at) || 0, day: ROME_DAY.format(new Date(at)), seller: (users[o.assignedTo] || "").slice(0, 30) };
    (wonByDay[w.day] = wonByDay[w.day] || []).push(w);
  }
  for (const d in wonByDay) wonByDay[d].sort((a, b) => a.ts - b.ts);

  // Tabella delle fasi: quanti lead e quanti soldi in ogni fase, con chi c'è dentro.
  const stages = GHL_STAGES.map((st) => {
    const inStage = opps.filter((o) => o.pipelineStageId === st.id && o.status !== "won" && o.status !== "lost");
    const items = inStage.map((o) => {
      const since = Date.parse(o.lastStageChangeAt || o.updatedAt || o.createdAt) || now;
      return { name: who(o), seller: (users[o.assignedTo] || "").slice(0, 30), value: num(Number(o.monetaryValue) || 0), days: Math.max(0, Math.floor((now - since) / 86400000)) };
    }).sort((a, b) => a.days - b.days);
    return {
      id: st.id, name: stageNames[st.id] || st.name, recall: !!st.recall, toCall: !!st.toCall,
      count: items.length, value: round2(items.reduce((s2, x) => s2 + x.value, 0)), items: items.slice(0, 150),
    };
  });
  const recall = stages.filter((st) => st.recall);
  const data = {
    leadsByDay, wonByDay, stages,
    toCall: stages.filter((st) => st.toCall).reduce((a, st) => a + st.count, 0),
    toRecall: recall.reduce((a, st) => a + st.count, 0),
    recallValue: round2(recall.reduce((a, st) => a + st.value, 0)),
  };
  ghlCache = { at: Date.now(), data };
  return data;
}

// Spesa ads Facebook dall'Ad Manager di GoHighLevel, giorno per giorno, con i lead che Facebook
// attribuisce alle ads (conversions). Tenuta 5 minuti: Facebook aggiorna questi numeri lentamente.
let adsCache = {};
async function readAds(env, from, to) {
  const key = from + "|" + to, hit = adsCache[key];
  if (hit && Date.now() - hit.at < 300000) return hit.data;
  const d = await ghl(env, `/ad-publishing/facebook/reporting?locationId=${GHL_LOCATION}&groupBy=day&startDate=${from}&endDate=${to}&type=AD_MANAGER&fields=spend,conversions,clicks,impressions`);
  const byDay = {};
  for (const g of d.grouped || []) {
    if (!DATE_RE.test(g.dateStart || "")) continue;
    byDay[g.dateStart] = { spend: num(Number(g.spend)), leads: Number(g.conversions) || 0 };
  }
  if (Object.keys(adsCache).length > 24) adsCache = {};
  adsCache[key] = { at: Date.now(), data: byDay };
  return byDay;
}

function monthPayload(ym, today, g, ads) {
  const nDays = daysInMonth(ym);
  const dates = Array.from({ length: nDays }, (_, i) => `${ym}-${pad2(i + 1)}`);
  const todayYm = today.slice(0, 7);
  const upTo = ym === todayYm ? Number(today.slice(8, 10)) : ym > todayYm ? 0 : nDays;
  const pastDates = dates.slice(0, upTo);
  const yesterday = addDays(today, -1);

  const wonOn = (d) => (g && g.wonByDay[d]) || [];
  const cashedOn = (d) => round2(wonOn(d).reduce((s, c) => s + c.amount, 0));
  const leadsOn = (d) => (g ? g.leadsByDay[d] || 0 : 0);

  const cashed = round2(pastDates.reduce((s, d) => s + cashedOn(d), 0));
  const clients = pastDates.reduce((s, d) => s + wonOn(d).length, 0);
  const leads = pastDates.reduce((s, d) => s + leadsOn(d), 0);
  const adsSpend = ads ? round2(pastDates.reduce((s, d) => s + (ads[d] ? ads[d].spend : 0), 0)) : 0;
  const adsLeads = ads ? pastDates.reduce((s, d) => s + (ads[d] ? ads[d].leads : 0), 0) : null;

  // Proiezione: incassato finora / giorni passati x giorni del mese.
  let projection = null, projectionNote = null;
  if (ym === todayYm) {
    if (upTo < 3) projectionNote = "La proiezione parte dal 3 del mese";
    else if (cashed <= 0) projectionNote = "Nessun incasso ancora questo mese";
    else projection = round2((cashed / upTo) * nDays);
  }

  return {
    today,
    todayData: {
      clients: wonOn(today),
      cashed: cashedOn(today),
      leads: leadsOn(today),
      toCall: g ? g.toCall : null,
      toRecall: g ? g.toRecall : null,
      recallValue: g ? g.recallValue : null,
    },
    yesterday: { cashed: cashedOn(yesterday), leads: leadsOn(yesterday) },
    series: dates.map((d, i) => ({ date: d, d: i + 1, today: d === today, future: d > today, cashed: cashedOn(d), leads: leadsOn(d) })),
    month: {
      ym, label: MONTH_LABEL.format(new Date(ym + "-01T12:00:00Z")),
      daysInMonth: nDays, elapsed: upTo,
      cashed, clients, leads, adsSpend, adsLeads, adsOk: !!ads,
      won: pastDates.flatMap((d) => wonOn(d).map((w) => ({ ...w, day: d }))).sort((a, b) => b.ts - a.ts),
      cpl: adsLeads > 0 && adsSpend > 0 ? round2(adsSpend / adsLeads) : null,
      cac: clients > 0 && adsSpend > 0 ? round2(adsSpend / clients) : null,
      roas: adsSpend > 0 ? round2(cashed / adsSpend) : null,
      projection, projectionNote,
      isCurrent: ym === todayYm, isFuture: ym > todayYm,
    },
    stages: g ? g.stages : null,
    ok: !!g,
  };
}

async function payload(ym, today, env) {
  if (!env.GHL_TOKEN) return monthPayload(ym, today, null, null);
  const lastDay = `${ym}-${pad2(daysInMonth(ym))}`;
  const [g, ads] = await Promise.all([
    readGHL(env).catch(() => null),
    `${ym}-01` <= today ? readAds(env, `${ym}-01`, lastDay < today ? lastDay : today).catch(() => null) : null,
  ]);
  return monthPayload(ym, today, g, ads);
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
<meta name="theme-color" content="#2b2a25">
<link rel="icon" type="image/png" href="/assets/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">`;

// Palette presa dai colori reali del quadro (campionati dall'immagine): grigi caldi del cielo in
// tempesta, terra d'ombra delle rocce, ruggine del mantello, oro dei galloni, avorio del cavallo.
const GLASS_CSS = `
  :root {
    --storm: #2b2a25;
    --earth: #1c1a16;
    --night: #14130f;
    --rust: #96482f;
    --gold: #b98318;
    --bone: #ece6da;
    --bone-2: rgba(236,230,218,0.70);
    --bone-3: rgba(236,230,218,0.48);
    --good: #6fdc9a;
    --bad: #ff8a80;
    --sans: "Geist", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    --serif: "Instrument Serif", "Iowan Old Style", Georgia, serif;
    --r-xl: 30px;
    --r-lg: 22px;
    --r-md: 14px;
  }
  * { box-sizing: border-box; }
  /* Sfondo: livelli di misura fissa (non dipendono da quanto è lunga la pagina, così scorrendo o
     aggiungendo righe i colori non si spostano). Niente livelli "fixed" o in fusione: davano lampi. */
  html {
    overflow-x: clip;
    min-height: 100%;
    background-color: var(--night);
    /* Più colori del quadro, sfumati uno nell'altro: grigio-oliva del cielo, oro dei galloni,
       ruggine e rosso del mantello, terra d'ombra delle rocce, un velo avorio del cavallo. */
    background-image:
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.045'/></svg>"),
      radial-gradient(1000px 740px at 90% 250px, rgba(192,72,40,0.55), rgba(192,72,40,0) 68%),
      radial-gradient(940px 640px at 46% -140px, rgba(200,148,58,0.44), rgba(200,148,58,0) 70%),
      radial-gradient(1000px 780px at -6% 60px, rgba(134,134,114,0.50), rgba(134,134,114,0) 70%),
      radial-gradient(680px 440px at 30% 330px, rgba(226,214,190,0.09), rgba(226,214,190,0) 70%),
      radial-gradient(920px 780px at 12% 820px, rgba(156,52,34,0.44), rgba(156,52,34,0) 70%),
      radial-gradient(1000px 760px at 64% 1080px, rgba(112,114,86,0.36), rgba(112,114,86,0) 70%),
      radial-gradient(820px 620px at 98% 1260px, rgba(196,142,58,0.26), rgba(196,142,58,0) 70%),
      radial-gradient(1100px 820px at -4% 1420px, rgba(128,100,70,0.42), rgba(128,100,70,0) 70%),
      linear-gradient(175deg, #2c2a24 0px, #1f1c17 700px, #17140f 1500px);
    background-repeat: repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat;
    background-size: 200px 200px, auto, auto, auto, auto, auto, auto, auto, auto, 100% 1500px;
  }
  body { margin: 0; color: var(--bone); font-family: var(--sans); font-size: 15px; line-height: 1.45; -webkit-font-smoothing: antialiased; background: transparent; }
  .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "ss01" 1; }

  /* Napoleone: posizionato dallo script accanto allo spazio libero (cavallo compreso); sfuma a
     sinistra e in basso nel gradiente della pagina. */
  .napo { position: absolute; top: 0; right: 0; height: 520px; width: 882px; z-index: -1; pointer-events: none;
    background: url(/assets/img/napoleone.jpg) center / cover no-repeat;
    filter: saturate(1.04) contrast(1.04) brightness(0.97);
    -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.45) 12%, #000 27%), linear-gradient(180deg, #000 48%, rgba(0,0,0,0.62) 68%, rgba(0,0,0,0.22) 86%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.45) 12%, #000 27%), linear-gradient(180deg, #000 48%, rgba(0,0,0,0.62) 68%, rgba(0,0,0,0.22) 86%, transparent 100%);
    mask-composite: intersect; }
  /* Contenitore che taglia la foto sul bordo destro: senza, la pagina si allargherebbe e scivolerebbe di lato. */
  .napo-clip { position: absolute; top: 0; left: 0; width: 100%; height: 600px; overflow: hidden; z-index: -1; pointer-events: none; }
  .napo-clip .napo { z-index: auto; }

  /* Vetro: base quasi trasparente, bordo che si accende negli angoli, riflesso in alto, ombra doppia */
  .glass { position: relative; isolation: isolate; border-radius: var(--r-xl);
    background: linear-gradient(180deg, rgba(255,255,255,0.085) 0%, rgba(255,255,255,0.035) 38%, rgba(255,255,255,0.02) 100%), rgba(22,20,17,0.40);
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
  .napo { height: 82vh; width: calc(82vh * 582 / 343); height: 82svh; width: calc(82svh * 582 / 343); }
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
<div class="napo" aria-hidden="true"></div>
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
    grid-template-areas: "top hole" "tiles hole" "chart side" "pipe side"; }
  .top { grid-area: top; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; min-height: 48px; }
  .tiles { grid-area: tiles; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gap); }
  .hole { grid-area: hole; position: relative; display: flex; align-items: flex-end; padding: 0 0 6px 6px; min-height: 240px; }
  .chart-card { grid-area: chart; }
  .pipe-card { grid-area: side; }
  .side { grid-area: pipe; min-width: 0; }

  /* Testata */
  .top img { height: 28px; display: block; }
  .when { display: flex; align-items: center; gap: 14px; padding: 7px 8px 7px 18px; border-radius: 999px; max-width: 100%; margin-left: auto; }
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
  .chip.warn i { background: #f2c14e; box-shadow: 0 0 0 3px rgba(242,193,78,0.18); }

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
    background: rgba(30,28,24,0.78); -webkit-backdrop-filter: blur(16px) saturate(1.6); backdrop-filter: blur(16px) saturate(1.6); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 10px 24px -10px rgba(0,0,0,0.6); }
  .tip.on { opacity: 1; }
  .tip b { display: block; font-size: 1rem; font-weight: 600; }
  .tip span { color: var(--bone-3); }

  /* Tabella della pipeline */
  .table { display: flex; flex-direction: column; min-height: 0; overflow: hidden; flex: 1; }
  .tr { display: grid; grid-template-columns: minmax(0, 1fr) 4.5rem 7rem; gap: 14px; align-items: center; padding: 10px 14px; }
  .thead { color: var(--bone-3); font-size: 0.82rem; padding-top: 0; padding-bottom: 8px; }
  .tbody { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; min-height: 0; }
  .tbody .tr { border-radius: var(--r-md); }
  .tbody .tr:nth-child(odd) { background: rgba(255,255,255,0.035); }
  .tr .n { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tr .v, .tr .w { text-align: right; color: var(--bone-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .srow .v, .srow .w { color: var(--bone); font-weight: 600; }
  .srow .n { white-space: normal; overflow-wrap: anywhere; line-height: 1.25; }
  .srow.recall .n::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f2c14e; margin-right: 9px; vertical-align: 1px; box-shadow: 0 0 0 3px rgba(242,193,78,0.16); }
  body.pc .srow { cursor: pointer; }
  body.pc .srow:hover { background: rgba(255,255,255,0.07); }
  .srow:focus-visible { outline: 2px solid var(--bone); outline-offset: -2px; }
  .srow.open { background: rgba(255,255,255,0.08); }
  .people { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 8px 18px; }
  .person { display: grid; grid-template-columns: minmax(0, 1fr) 6rem 6.5rem 5.5rem; gap: 12px; padding: 7px 12px; border-radius: 10px; font-size: 0.88rem; background: rgba(0,0,0,0.14); }
  .person .pn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .person .ps, .person .pd { color: var(--bone-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .person .pv { text-align: right; color: var(--bone-2); }
  .money-chip { flex: none; padding: 7px 14px; border-radius: 999px; color: #f6d27a; background: rgba(242,193,78,0.12); box-shadow: inset 0 0 0 1px rgba(242,193,78,0.35); font-size: 0.92rem; }
  .money-chip:empty { display: none; }
  .pipe-card .card-head { flex-wrap: wrap; }
  .pipe-card .card-head .meta { white-space: nowrap; }
  .money-chip b { font-size: 1.1rem; }
  .table .none { color: var(--bone-3); padding: 18px 14px; }

  /* Clienti di oggi */
  .side { display: flex; flex-direction: column; }
  .clickable { cursor: pointer; }
  .clickable:focus-visible { outline: 2px solid var(--bone); outline-offset: 3px; }
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: 999px; flex: none; }
  .seg button { border: 0; background: transparent; color: var(--bone-2); font: inherit; font-size: 0.85rem; font-weight: 600; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
  .seg button.on { background: rgba(255,255,255,0.12); color: var(--bone); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14); }
  .seg button:focus-visible { outline: 2px solid var(--bone); outline-offset: 1px; }
  .cl .day { color: var(--bone-2); }
  .chart .bar.picked { fill: #e3ad3a; }
  .clients { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; flex: 1; }
  .cl { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--r-lg); background: rgba(255,255,255,0.045); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
  .cl .av { width: 38px; height: 38px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #241a06;
    background: radial-gradient(120% 120% at 30% 20%, #f3d58c, #b98318 70%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); }
  .cl .who { flex: 1; min-width: 0; }
  .cl .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cl .time { color: var(--bone-3); font-size: 0.8rem; }
  .cl .amt { font-weight: 600; font-size: 1.05rem; }
  .cl .seller { color: var(--bone-3); }
  .cl.new { animation: newcl 1.6s ease-out; }
  @keyframes newcl { 0% { box-shadow: inset 0 0 0 1px rgba(243,213,140,0.9), 0 0 30px rgba(243,213,140,0.35); } 100% { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); } }
  .clients .none { color: var(--bone-3); padding: 14px 4px; }

  /* Annuncio nuovo cliente: l'unico momento animato */
  .toast { position: fixed; left: 50%; top: 44%; z-index: 20; transform: translate(-50%, -50%) scale(0.94); opacity: 0; pointer-events: none; text-align: center; padding: 28px 48px 30px; border-radius: 40px; visibility: hidden; transition: opacity .45s, transform .45s cubic-bezier(.2,.9,.3,1.2), visibility 0s .45s; }
  .toast.on { opacity: 1; visibility: visible; transform: translate(-50%, -50%) scale(1); transition: opacity .45s, transform .45s cubic-bezier(.2,.9,.3,1.2), visibility 0s; }
  .toast .k { font-family: var(--serif); font-style: italic; font-size: clamp(1.4rem, 2.2vw, 2.2rem); color: var(--bone-2); }
  .toast .n { font-size: clamp(2rem, 4.4vw, 4.4rem); font-weight: 600; letter-spacing: -0.035em; margin-top: 4px; }
  .toast .a { font-size: clamp(1.6rem, 3.2vw, 3.2rem); font-weight: 600; color: var(--good); letter-spacing: -0.02em; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: opacity .2s; } .cl.new { animation: none; } }


  /* TV: tutto in uno schermo */
  body.tv { height: 100vh; overflow: hidden; }
  body.tv .layout { height: 100vh; max-width: none; grid-template-rows: auto auto minmax(0, 1fr) minmax(0, 1.1fr); grid-template-areas: "top hole" "tiles hole" "chart side" "pipe side"; }
  body.tv .chart { min-height: 0; }
  body.tv .pipe-card .tr { padding-top: 6px; padding-bottom: 6px; }
  body.tv .pipe-card .card-head { margin-bottom: 6px; }

  @media (max-width: 1180px) {
    .layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: "top" "hole" "tiles" "side" "chart" "pipe"; }
    .hole { min-height: 300px; }
    .side .clients { max-height: 420px; }
  }
  @media (max-width: 640px) {
    body { font-size: 14px; }
    .when .d { display: none; }
    .when { padding: 5px; gap: 8px; }
    .alert { font-size: 0.75rem; padding: 6px 10px; }
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
    .tr { grid-template-columns: minmax(0, 1fr) 2.6rem 5.4rem; gap: 8px; padding: 9px 10px; font-size: 0.9rem; }
    .people { margin-left: 6px; }
    .person { grid-template-columns: minmax(0, 1fr) 4.6rem; gap: 2px 8px; }
    .person .ps { grid-column: 1; } .person .pd { grid-column: 2; grid-row: 2; text-align: right; }
  }
</style>
</head>
<body class="${tv ? "tv" : "pc"}">
<div class="napo-clip" id="napoClip" aria-hidden="true"><div class="napo" id="napo"></div></div>
<div class="layout" id="screen">
  <header class="top">
    <img src="/assets/img/logo.png" alt="Vendita Uno">
    <div class="when glass"><span class="alert" id="alert">GoHighLevel non raggiungibile</span><span class="d" id="date"></span><span class="clock num well" id="clock"></span></div>
  </header>

  <section class="tiles" aria-label="Numeri principali">
    <div class="tile glass hero">
      <div>
        <h3>Incassato oggi</h3>
        <div class="big num" id="kToday">€ 0</div>
      </div>
      <div class="side-stats" id="kTodaySub"></div>
    </div>
    <div class="tile glass clickable" id="tileMonth" role="button" tabindex="0" title="Vedi chi avete chiuso nel mese">
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

  <section class="card glass pipe-card">
    <div class="card-head">
      <div><h2>Pipeline</h2><div class="meta">VENDITA PIPELINE, adesso</div></div>
      <div class="money-chip" id="recallTotal"></div>
    </div>
    <div class="table">
      <div class="tr thead"><span class="n">Fase</span><span class="v">Lead</span><span class="w">Valore</span></div>
      <div class="tbody" id="pipe"></div>
    </div>
  </section>

  <section class="card glass side">
    <div class="card-head"><div><h2 id="clTitle">Chiusi oggi</h2><div class="meta" id="clMeta"></div></div>
      <div class="seg well" role="group" aria-label="Quali chiusi vedere"><button type="button" id="vToday" class="on">Oggi</button><button type="button" id="vMonth">Mese</button></div></div>
    <div class="clients" id="clients"></div>
  </section>

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
let data = null, curMonth = null, lastClientsKey = null, seen = null;
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

// Napoleone si allinea al buco: la foto parte dall'alto della pagina, finisce poco sotto il buco e il
// muso del cavallo (circa il 26% della larghezza del quadro) cade sul bordo sinistro del buco.
// Si riscrive solo se la misura cambia davvero: niente salti mentre si scorre.
let napoKey = '';
function placeNapo() {
  const hole = $('hole'), napo = $('napo');
  const r = hole.getBoundingClientRect();
  const h = Math.round(r.bottom + window.scrollY + Math.min(80, r.height * 0.25));
  const w = Math.round(h * 582 / 343);
  const left = Math.round(r.left + window.scrollX - w * 0.26);
  const key = h + ',' + w + ',' + left;
  if (key === napoKey) return;
  napoKey = key;
  napo.style.cssText = 'height:' + h + 'px;width:' + w + 'px;left:' + left + 'px;right:auto';
  $('napoClip').style.height = h + 'px';
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
  const max = maxV > 0 ? niceMax(maxV) : 1000;
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
    hit.addEventListener('click', () => { on(); if (b.s.cashed > 0) setView({ mode: 'day', day: b.s.date }); });
    if (b.bar && view.mode === 'day' && view.day === b.s.date) b.bar.classList.add('picked');
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

// Scrive nel DOM solo se il contenuto è cambiato: con i dati uguali la pagina resta ferma, niente lampi.
const lastSet = {};
function setHTML(id, html) { if (lastSet[id] === html) return; lastSet[id] = html; $(id).innerHTML = html; }
function setText(id, text) { if (lastSet[id] === text) return; lastSet[id] = text; $(id).textContent = text; }

// Il grafico si ridisegna solo se cambiano i dati o la misura del riquadro.
let chartKey = '', chartSize = '';
function drawChartIfNeeded(force) {
  if (!data) return;
  const box = $('chCash');
  const size = box.clientWidth + 'x' + box.clientHeight;
  const key = data.month.ym + '|' + data.series.map((s) => s.cashed + (s.today ? 't' : '') + (s.future ? 'f' : '')).join(',');
  if (!force && key === chartKey && size === chartSize) return;
  chartKey = key; chartSize = size;
  drawCash(box, data.series);
}
if (window.ResizeObserver) {
  new ResizeObserver(() => drawChartIfNeeded()).observe($('chCash'));
  new ResizeObserver(() => placeNapo()).observe($('hole'));
}
window.addEventListener('resize', () => placeNapo());
if (document.fonts) document.fonts.ready.then(() => { placeNapo(); drawChartIfNeeded(); });
placeNapo();

// ---- Annuncio nuovo cliente ----
let toastT;
function announce(c) {
  $('toastName').textContent = c.name;
  $('toastAmt').textContent = '+ ' + money(c.amount);
  $('toast').classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('on'), 4500);
}


// Scheda "Chiusi": oggi (predefinito), un giorno scelto dal grafico, o tutto il mese.
let view = { mode: 'today', day: '' };
function setView(v) {
  view = v;
  if (data) { renderClosed([]); drawChartIfNeeded(true); }
}
function closedRow(c, showDay, isNew) {
  const time = new Date(c.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
  return '<div class="cl' + (isNew ? ' new' : '') + '"><div class="av">' + esc((c.name.trim()[0] || '?').toUpperCase()) + '</div>' +
    '<div class="who"><div class="name">' + esc(c.name) + '</div><div class="time">' + (showDay ? '<span class="day">' + esc(dayLabel(c.day)) + '</span> ' : '') + time +
    (c.seller ? ' <span class="seller">' + esc(c.seller) + '</span>' : '') + '</div></div>' +
    '<div class="amt num">' + money(c.amount) + '</div></div>';
}
function renderClosed(freshIds) {
  const d = data, mo = d.month, monthName = mo.label.split(' ')[0];
  if (view.mode === 'day' && !view.day.startsWith(mo.ym)) view = { mode: 'today', day: '' };
  let mode = view.mode, list, title;
  if (mode === 'day') {
    list = mo.won.filter((c) => c.day === view.day);
    title = 'Chiusi ' + dayLabel(view.day);
  } else if (mode === 'month') {
    list = mo.won;
    title = 'Chiusi a ' + monthName;
  } else {
    list = d.todayData.clients.slice().reverse().map((c) => ({ ...c, day: d.today }));
    title = 'Chiusi oggi';
  }
  const total = list.reduce((s, c) => s + c.amount, 0);
  setText('clTitle', title);
  setText('clMeta', list.length ? money0(total) + ' da ' + plural(list.length, 'chiuso', 'chiusi') : '');
  $('vToday').classList.toggle('on', view.mode === 'today');
  $('vMonth').classList.toggle('on', view.mode === 'month');
  const key = mode + '|' + view.day + '|' + mo.ym + '|' + list.map((c) => c.id + ':' + c.amount).join(',');
  if (key === lastClientsKey && !freshIds.length) return;
  lastClientsKey = key;
  const showDay = mode !== 'today';
  $('clients').innerHTML = list.length ? list.map((c) => closedRow(c, showDay, tvMode && freshIds.indexOf(c.id) >= 0)).join('')
    : '<div class="none">' + (mode === 'today' ? 'Nessun chiuso oggi.' + (mo.won.length ? ' Premi "Mese" per vedere quelli di ' + monthName + '.' : '') : 'Nessun chiuso in questo periodo.') + '</div>';
}

// Scheda "Pipeline": fasi in ordine con lead e valore; sul PC un clic su una fase mostra chi c'è dentro.
let openStage = '';
function waited(n) { return n === 0 ? 'da oggi' : n === 1 ? 'da ieri' : 'da ' + n + ' giorni'; }
function renderPipe(d) {
  if (!d.stages) {
    setHTML('recallTotal', '');
    setHTML('pipe', '<div class="none">GoHighLevel non risponde: la pipeline torna appena è raggiungibile.</div>');
    return;
  }
  setHTML('recallTotal', d.todayData.toRecall ? '<b>' + money0(d.todayData.recallValue) + '</b> da prendere richiamando' : '');
  setHTML('pipe', d.stages.map((st) => {
    const open = !tvMode && openStage === st.id && st.items.length > 0;
    return '<div class="tr srow' + (st.recall ? ' recall' : '') + (open ? ' open' : '') + '" data-id="' + esc(st.id) + '"' +
      (tvMode ? '' : ' role="button" tabindex="0" aria-expanded="' + open + '"') + '>' +
      '<span class="n">' + esc(st.name) + '</span><span class="v num">' + grp(st.count) + '</span><span class="w num">' + money0(st.value) + '</span></div>' +
      (open ? '<div class="people">' + st.items.map((x) => '<div class="person"><span class="pn">' + esc(x.name) + '</span><span class="ps">' + esc(x.seller || ' ') + '</span>' +
        '<span class="pd">' + waited(x.days) + '</span><span class="pv num">' + money0(x.value) + '</span></div>').join('') + '</div>' : '');
  }).join(''));
}
function toggleStage(id) {
  openStage = openStage === id ? '' : id;
  if (data) renderPipe(data);
}

function render(d) {
  const firstLoad = data === null;
  data = d; curMonth = d.month.ym;
  const t = d.todayData, mo = d.month, monthName = mo.label.split(' ')[0];
  setText('date', cap(new Date(d.today + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })));
  setText('alert', 'GoHighLevel non raggiungibile');
  $('alert').classList.toggle('on', !d.ok);

  // Incassato oggi
  setNum('kToday', t.cashed, 'money');
  const nC = t.clients.length;
  setHTML('kTodaySub', '<div class="stat">' + (nC ? '<b>' + nC + '</b> ' + (nC === 1 ? 'chiuso' : 'chiusi') : 'Ancora nessun chiuso') + '</div>' +
    '<div class="stat">' + trend(Math.round((t.cashed - d.yesterday.cashed) * 100) / 100, money0) + '</div>');

  // Incassato del mese e proiezione
  setText('kMonthLabel', 'Incassato a ' + monthName);
  setNum('kMonth', mo.cashed, 'money');
  setHTML('kMonthSub',
    (mo.projection != null ? '<span>Proiezione <b>' + money0(mo.projection) + '</b></span>' : mo.projectionNote ? '<span>' + esc(mo.projectionNote) + '</span>' : mo.isFuture ? '' : '<span>Mese chiuso</span>') +
    (mo.clients ? '<span><b>' + mo.clients + '</b> ' + (mo.clients === 1 ? 'chiuso' : 'chiusi') + '</span>' : ''));

  // Lead
  setNum('kLeads', t.leads, 'int');
  setHTML('kLeadsSub', '<span class="chip' + (t.toCall ? '' : ' ok') + '"><i></i>' + grp(t.toCall || 0) + ' da chiamare</span>' +
    (t.toRecall != null ? '<span class="chip warn"><i></i>' + grp(t.toRecall) + ' da richiamare</span>' : '') + trend(t.leads - d.yesterday.leads, grp));

  // Ritorno sulla spesa ads del mese
  setText('kRoasLabel', 'Ritorno sulle ads a ' + monthName);
  setText('kRoas', mo.roas != null ? nf1.format(mo.roas).replace(',0', '') + 'x' : 'n.d.');
  setHTML('kRoasSub', mo.adsSpend > 0
    ? '<span><b>' + money0(mo.adsSpend) + '</b> spesi</span>' + (mo.adsLeads != null ? '<span><b>' + grp(mo.adsLeads) + '</b> lead dalle ads</span>' : '') + (mo.cpl != null ? '<span>CPL <b>' + money0(mo.cpl) + '</b></span>' : '') + (mo.cac != null ? '<span>CAC <b>' + money0(mo.cac) + '</b></span>' : '')
    : '<span>' + (mo.adsOk ? 'Nessuna spesa ads in questo mese' : 'Spesa ads non disponibile da GoHighLevel') + '</span>');

  // Grafico
  setText('mLabel', cap(mo.label));
  $('mNext').disabled = mo.isCurrent || mo.isFuture;
  const best = d.series.filter((s) => !s.future).reduce((b, s) => (s.cashed > (b ? b.cashed : 0) ? s : b), null);
  setText('cashMeta', best ? 'Giorno migliore: ' + dayLabel(best.date) + ', ' + money0(best.cashed) : 'Nessun incasso in questo mese');
  drawChartIfNeeded();

  renderPipe(d);

  // Annuncio sulla TV quando arriva una nuova vinta oggi
  const todayIds = t.clients.map((c) => c.id);
  const fresh = seen ? t.clients.filter((c) => !seen.has(c.id)) : [];
  if (tvMode && fresh.length && !firstLoad) announce(fresh[fresh.length - 1]);
  seen = new Set(todayIds);
  renderClosed(fresh.map((c) => c.id));

  placeNapo();
}

// Ordine delle risposte: se si cambia mese in fretta, una risposta arrivata tardi non copre quella nuova.
let seq = 0, lastApplied = 0;
function apply(d, mySeq) {
  if (mySeq < lastApplied) return;
  lastApplied = mySeq;
  render(d);
}

async function refresh(ym) {
  const mySeq = ++seq;
  try {
    const r = await fetch(API + (ym ? '?month=' + ym : ''), { cache: 'no-store' });
    if (r.status === 401) { location.reload(); return; }
    apply(await r.json(), mySeq);
  } catch (e) { setText('alert', 'Connessione persa, riprovo'); $('alert').classList.add('on'); }
}
function shift(ym, n) { const p = ym.split('-').map(Number); const t = p[0] * 12 + p[1] - 1 + n; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); }

function tick() { $('clock').textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }); }
tick(); setInterval(tick, 1000);
// Ogni 5 secondi: con TV e PC sempre aperti resta sotto le 100.000 richieste al giorno del piano gratuito di Cloudflare.
refresh(); setInterval(() => refresh(curMonth), 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(curMonth); });
async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch (e) {} }
keepAwake(); document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
$('screen').addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
$('mPrev').onclick = () => refresh(shift(curMonth, -1));
$('mNext').onclick = () => { if (!$('mNext').disabled) refresh(shift(curMonth, 1)); };
$('pipe').onclick = (e) => { const r = e.target.closest('.srow'); if (r && !tvMode) toggleStage(r.dataset.id); };
$('pipe').onkeydown = (e) => { const r = e.target.closest('.srow'); if (r && !tvMode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleStage(r.dataset.id); } };
$('vToday').onclick = () => setView({ mode: 'today', day: '' });
$('vMonth').onclick = () => setView({ mode: 'month', day: '' });
$('tileMonth').onclick = () => setView({ mode: 'month', day: '' });
$('tileMonth').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView({ mode: 'month', day: '' }); } };

</script>
</body>
</html>`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-\d{2}$/;

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
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const today = romeDate();
    const ym = YM_RE.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : today.slice(0, 7);
    return json(await payload(ym, today, env));
  }

  if (path === DASH_PATH || path === `${DASH_PATH}/login`) {
    return html(loggedIn ? dashboardPage(false) : loginPage(null));
  }

  if (path === `${DASH_PATH}/tv`) {
    return html(loggedIn ? dashboardPage(true) : loginPage(null, true));
  }

  return new Response(null, { status: 302, headers: { Location: DASH_PATH } });
}
