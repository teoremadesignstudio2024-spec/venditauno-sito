// API dell'app Vendita Uno (/app). Tutti i dati stanno nel KV ACADEMY_PROGRESS con prefisso "app:".
//
// Configurazione (Cloudflare → Workers → venditauno-sito → Impostazioni → Variabili, tipo "Secret"):
//   APP_SECRET    stringa lunga e casuale per firmare le sessioni
//   ADMIN_EMAILS  email degli amministratori separate da virgola (diventano admin al login)

const COOKIE = "vu_app_session";
const SESSION_DAYS = 30;
const FALLBACK_SECRET = "vendita-uno-app-temp-secret-change-me-2026";
const PBKDF2_ITER = 100000;
const MAX_IMG_BYTES = 400 * 1024;
// Codice per diventare amministratore dall'app (si può usare una sola volta). Qui c'è solo l'impronta, non il codice.
const ADMIN_CLAIM_HASH = "9c66fa87d953e698e3a3681f8179447dab06044cc173f35bcd820c24fe7bde91";

// ---------- utility ----------

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rid = (n = 10) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Date.now();
// Chiavi ordinate dalla più recente: KV elenca in ordine alfabetico.
const invTs = () => String(9999999999999 - now()).padStart(13, "0");

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store", ...headers },
  });
}
const fail = (msg, status = 400) => json({ error: msg }, status);

function str(v, max = 200) {
  return (v == null ? "" : String(v)).trim().slice(0, max);
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

async function hashPassword(password, salt, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: iter, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const secretOf = (env) => env.APP_SECRET || FALLBACK_SECRET;

async function makeToken(uid, env) {
  const exp = now() + SESSION_DAYS * 86400000;
  const sig = await hmac(`${uid}.${exp}`, secretOf(env));
  return `${uid}.${exp}.${sig}`;
}

async function readToken(request, env) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [uid, exp, sig] = m[1].split(".");
  if (!uid || !exp || !sig) return null;
  if (now() > Number(exp)) return null;
  const expected = await hmac(`${uid}.${exp}`, secretOf(env));
  return safeEqual(sig, expected) ? uid : null;
}

const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const isAdminEmail = (email, env) =>
  (env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean).includes(email);

// ---------- KV ----------

const getJSON = async (kv, key, fallback = null) => {
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : fallback;
};
const putJSON = (kv, key, value, opts) => kv.put(key, JSON.stringify(value), opts);

async function listAll(kv, prefix, limit = 1000) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: Math.min(1000, limit - out.length) });
    out.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < limit);
  return out;
}

const userMeta = (u) => ({ n: `${u.name} ${u.surname}`.trim(), e: u.email, r: u.role, ref: u.referredBy || "", c: u.city || "", t: u.createdAt, a: u.avatar || "" });

async function saveUser(kv, u) {
  await kv.put(`app:user:${u.id}`, JSON.stringify(u), { metadata: userMeta(u) });
}

function publicUser(u) {
  const { pass, ...rest } = u;
  return rest;
}

// ---------- contenuti iniziali ----------
// Struttura: accademia → sottocategorie → corsi → lezioni. Tutto modificabile dal pannello admin.

const CATALOG_V = 14;

function catalogAcademies() {
  return [
    { id: "agenti", name: "Agenti immobiliari", icon: "handshake", color: "#2f6bff", cover: "", card: "/app/academies/agenti.jpg", subs: [
      { id: "inizia", name: "Inizia da qui!", icon: "play" },
      { id: "basi", name: "Le basi di un'agenzia che vende", icon: "home2" },
      { id: "zona", name: "Diventa il punto di riferimento della tua zona", icon: "pin" },
      { id: "numeri", name: "I numeri che contano", icon: "trend" },
      { id: "team", name: "Costruire un team che vende", icon: "users" },
      { id: "organizzata", name: "L'agenzia organizzata", icon: "tool" },
      { id: "freno", name: "Cosa ti sta frenando", icon: "brain" },
    ] },
  ];
}

function catalogModules() {
  const yt = "jqOjebgNQvk";
  const C = (id, academyId, subId, level, title, desc, lessons) => ({
    id, academyId, subId, level, title, desc, educatorId: "", cover: "",
    lessons: lessons.map(([t, d], i) => ({ id: `${id}v${i + 1}`, title: t, youtubeId: "", minutes: 0, desc: d || "", pdf: "" })),
  });
  return [
    // Agenti immobiliari (i primi tre corsi esistevano già)
    { id: "m1", title: "Introduzione al metodo", desc: "Come funziona Vendita Uno e come usare l'accademia.", academyId: "agenti", subId: "inizia", educatorId: "sd", level: "base", cover: "", lessons: [{ id: "m1v1", title: "Introduzione al metodo Vendita Uno", youtubeId: yt, minutes: 6, desc: "", pdf: "" }] },
    { id: "m2", title: "Acquisizione mandati", desc: "Dal primo contatto all'incarico in esclusiva.", academyId: "agenti", subId: "zona", educatorId: "sd", level: "premium", cover: "", lessons: [{ id: "m2v1", title: "Come acquisire mandati in esclusiva", youtubeId: yt, minutes: 18, desc: "", pdf: "" }] },
    C("ag-tra1", "agenti", "basi", "premium", "Trattativa senza sconti", "Difendere il prezzo e la provvigione portando le parti all'accordo.", [
      ["Preparare la trattativa", "Cosa sapere di venditore e acquirente prima di sederti al tavolo."],
      ["Le obiezioni sul prezzo", "Come rispondere a \"è troppo\" senza abbassare subito."],
      ["Portare le parti all'accordo", "Proposta, controproposta e quando fermarsi."],
    ]),
    { id: "m3", title: "Chiusura e firma", desc: "Portare il cliente alla firma senza pressioni.", academyId: "agenti", subId: "basi", educatorId: "md", level: "premium", cover: "", lessons: [{ id: "m3v1", title: "Chiusura e firma del mandato", youtubeId: yt, minutes: 15, desc: "", pdf: "" }] },
    C("ag-chi1", "agenti", "zona", "base", "Chiamate a freddo che funzionano", "Lo script, il tono e i numeri per trasformare le chiamate in appuntamenti.", [
      ["I primi 30 secondi", "Come presentarti senza farti attaccare il telefono."],
      ["Chiamare i privati che vendono da soli", "La telefonata completa, frase per frase."],
      ["Gestire il \"non mi interessa\"", "Le risposte che riaprono la conversazione."],
      ["Quante chiamate fare ogni giorno", "I numeri che servono per arrivare ai tuoi incarichi."],
    ]),
  ];
}

function seedContent() {
  // Settimana corrente (lunedì) in ora italiana approssimata: le live di esempio partono da qui.
  const d = new Date();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  const at = (day, hh, mm) => new Date(monday.getTime() + day * 86400000 + (hh - 2) * 3600000 + mm * 60000).toISOString();
  return {
    seedV: CATALOG_V,
    academies: catalogAcademies(),
    educators: [
      { id: "sd", name: "Samuele Diotti", academyId: "agenti", role: "Acquisizione in esclusiva", bio: "Insegna come arrivare al primo appuntamento e uscire con l'incarico firmato.", photo: "/assets/img/samuele-diotti.jpg", email: "" },
      { id: "md", name: "Marco Diotti", academyId: "agenti", role: "Trattativa e chiusura", bio: "Script, obiezioni e chiusura: tutto quello che serve dal sopralluogo al rogito.", photo: "/assets/img/marco-diotti.jpg", email: "" },
      { id: "sb", name: "Stefano Bonuccelli", academyId: "agenti", role: "Mindset e organizzazione", bio: "Numeri, abitudini e metodo per lavorare con costanza ogni settimana.", photo: "/assets/img/stefano-bonuccelli.png", email: "" },
    ],
    modules: catalogModules(),
    banners: defaultBanners(),
    settings: defaultSettings(),
    lives: [
      { id: "l1", educatorId: "md", title: "Le 5 domande da fare prima del sopralluogo", desc: "Cosa chiedere al proprietario al telefono per arrivare al sopralluogo con l'incarico mezzo in tasca.", start: at(0, 18, 30), minutes: 60, url: "", replayUrl: "" },
      { id: "l2", educatorId: "sd", title: "Acquisire in esclusiva al primo appuntamento", desc: "Come presentare il servizio, quando parlare di esclusiva e come rispondere a \"ci devo pensare\".", start: at(1, 21, 0), minutes: 75, url: "", replayUrl: "" },
      { id: "l3", educatorId: "sb", title: "Gestire l'obiezione \"la provvigione è alta\"", desc: "Perché il cliente contesta la provvigione e cosa dire per far capire il valore, senza fare sconti.", start: at(2, 21, 0), minutes: 60, url: "", replayUrl: "" },
      { id: "l4", educatorId: "md", title: "Script per i privati che vendono da soli", desc: "La telefonata completa, frase per frase.", start: at(3, 18, 30), minutes: 60, url: "", replayUrl: "" },
      { id: "l5", educatorId: "sd", title: "Revisione chiamate dal vivo", desc: "Mandi la registrazione di una tua chiamata e la correggiamo insieme.", start: at(4, 18, 0), minutes: 90, url: "", replayUrl: "" },
      { id: "l6", educatorId: "sb", title: "Pianificare la settimana: i numeri che contano", desc: "Quante chiamate, appuntamenti e incarichi ti servono per il tuo obiettivo.", start: at(5, 10, 0), minutes: 45, url: "", replayUrl: "" },
    ],
  };
}

function defaultBanners() {
  return [
    { id: "b1", title: "Accademia Vendita Uno", text: "Il metodo completo per acquisire incarichi in esclusiva, passo dopo passo.", cover: "", link: "#/accademia" },
    { id: "b2", title: "Live ogni settimana", text: "Gli educatori in diretta: domande, esempi veri e revisione delle chiamate.", cover: "", link: "#/live" },
    { id: "b3", title: "Notizie esclusive", text: "Ti diamo noi le persone da chiamare, solo a te, nella tua zona.", cover: "", link: "#/notizie" },
  ];
}
const defaultSettings = () => ({ welcomeTitle: "Benvenuto!", welcomeSub: "Scopri Vendita Uno", onboardingTitle: "Inizia da qui", onboardingText: "Scopri come usare l'app e tutto quello che offre", onboardingVideo: "jqOjebgNQvk", presentationPdf: "" });

// Vecchie accademie (versioni 1 e 2) → nuova accademia e sottocategoria.
const OLD_ACADEMIES = { acq: ["agenti", "zona"], tra: ["agenti", "basi"], chi: ["agenti", "zona"], soc: ["agenti", ""], min: ["agenti", ""], fin: ["agenti", ""], leg: ["agenti", ""], ai: ["agenti", ""], inv: ["agenti", ""] };

// Porta i contenuti salvati con una versione precedente alla struttura con sottocategorie.
// Mantiene video, copertine e modifiche fatte dall'admin; aggiunge solo ciò che manca.
function migrateContent(c) {
  const catA = catalogAcademies(), catM = catalogModules();
  const custom = c.academies.filter((a) => !OLD_ACADEMIES[a.id] && !catA.some((x) => x.id === a.id));
  c.academies = [...catA.map((a) => ({ ...a, ...(c.academies.find((x) => x.id === a.id) || {}), subs: a.subs })), ...custom];
  for (const e of c.educators) if (OLD_ACADEMIES[e.academyId]) e.academyId = OLD_ACADEMIES[e.academyId][0];
  for (const m of c.modules) {
    const cat = catM.find((x) => x.id === m.id);
    if (cat) { m.academyId = cat.academyId; m.subId = cat.subId; }
    else if (OLD_ACADEMIES[m.academyId]) [m.academyId, m.subId] = OLD_ACADEMIES[m.academyId];
  }
  for (const m of catM) if (!c.modules.some((x) => x.id === m.id)) c.modules.push(m);
  c.seedV = 3;
  return c;
}

async function getContent(kv) {
  let c = await getJSON(kv, "app:content");
  if (!c) {
    c = seedContent();
    await putJSON(kv, "app:content", c);
  }
  c.banners = c.banners || defaultBanners();
  c.products = c.products || [];
  c.settings = { ...defaultSettings(), ...(c.settings || {}) };
  if ((c.seedV || 1) < 3) migrateContent(c);
  if ((c.seedV || 1) < 5) {
    // Tolta la foto dal banner delle live: torna il banner con le sole scritte.
    const b2 = c.banners.find((b) => b.id === "b2");
    if (b2 && (b2.cover || "").startsWith("/app/banners/live")) Object.assign(b2, { title: "Live ogni settimana", cover: "" });
  }
  if ((c.seedV || 1) < 6) {
    // Rimessa la prima foto del banner delle live (solo se il banner non è stato cambiato dall'admin).
    const b2 = c.banners.find((b) => b.id === "b2");
    if (b2 && !b2.cover && b2.title === "Live ogni settimana") Object.assign(b2, defaultBanners().find((b) => b.id === "b2"));
  }
  if ((c.seedV || 1) < 7) {
    // Card dell'accademia Agenti immobiliari fatta su Canva.
    const ag = c.academies.find((a) => a.id === "agenti");
    if (ag && !ag.card) ag.card = "/app/academies/agenti.jpg";
  }
  if ((c.seedV || 1) < 8) {
    const inv = c.academies.find((a) => a.id === "inv");
    if (inv && !inv.card) inv.card = "/app/academies/investimenti-immobiliari.jpg";
  }
  if ((c.seedV || 1) < 9) {
    // Banner delle live: tolta la foto, torna quello originale con le scritte.
    const b2 = c.banners.find((b) => b.id === "b2");
    if (b2 && ((b2.cover || "").startsWith("/app/banners/live") || (!b2.cover && b2.title === "Live ogni settimana"))) Object.assign(b2, defaultBanners().find((b) => b.id === "b2"));
  }
  if ((c.seedV || 1) < 10) {
    const pm = c.academies.find((a) => a.id === "pm");
    if (pm && !pm.card) pm.card = "/app/academies/property-manager.jpg";
  }
  if ((c.seedV || 1) < 11) {
    // Nuova versione della card Investimenti immobiliari.
    const inv = c.academies.find((a) => a.id === "inv");
    if (inv && inv.card === "/app/academies/investimenti.jpg") inv.card = "/app/academies/investimenti-immobiliari.jpg";
  }
  if ((c.seedV || 1) < 12) {
    // Tolte Marketing immobiliare e Mutui e finanza; aggiunte Amministratore di condominio e Home stager.
    c.academies = c.academies.filter((a) => a.id !== "mkt" && a.id !== "fin");
    c.modules = c.modules.filter((m) => m.academyId !== "mkt" && m.academyId !== "fin");
    const catA = catalogAcademies(), catM = catalogModules();
    for (const id of ["cond", "hs"]) { const x = catA.find((a) => a.id === id); if (x && !c.academies.some((a) => a.id === id)) c.academies.push(x); }
    for (const m of catM) if ((m.academyId === "cond" || m.academyId === "hs") && !c.modules.some((x) => x.id === m.id)) c.modules.push(m);
  }
  if ((c.seedV || 1) < 13) {
    // Resta solo l'accademia Agenti immobiliari: tolte le altre e i loro corsi.
    const keep = new Set(catalogAcademies().map((a) => a.id));
    c.academies = c.academies.filter((a) => keep.has(a.id));
    c.modules = c.modules.filter((m) => keep.has(m.academyId));
    c.educators = c.educators.map((e) => (keep.has(e.academyId) || !e.academyId ? e : { ...e, academyId: "agenti" }));
  }
  if ((c.seedV || 1) < 14) {
    // Nuove sezioni dell'Accademia; i corsi già esistenti vanno nella sezione più vicina.
    const ag = c.academies.find((a) => a.id === "agenti");
    if (ag) ag.subs = catalogAcademies()[0].subs;
    const move = { acq: "zona", tra: "basi", chiu: "basi", chi: "zona" };
    const ids = new Set(catalogAcademies()[0].subs.map((x) => x.id));
    for (const m of c.modules) {
      if (m.academyId !== "agenti") continue;
      if (m.id === "m1") m.subId = "inizia";
      else if (move[m.subId]) m.subId = move[m.subId];
      else if (!ids.has(m.subId)) m.subId = "inizia";
    }
  }
  if ((c.seedV || 1) < CATALOG_V) {
    c.seedV = CATALOG_V;
    await putJSON(kv, "app:content", c);
  }
  return c;
}

// ---------- validazione contenuti admin ----------

const SECTIONS = {
  academies: (a) => ({ id: str(a.id, 40) || rid(4), name: str(a.name, 60), icon: str(a.icon, 20) || "cap", color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#2f6bff", cover: str(a.cover, 300), hero: str(a.hero, 300), card: str(a.card, 300),
    subs: (Array.isArray(a.subs) ? a.subs : []).slice(0, 40).map((x) => ({ id: str(x.id, 40) || rid(4), name: str(x.name, 60), icon: str(x.icon, 20) || "cap" })).filter((x) => x.name) }),
  products: (p) => ({ id: str(p.id, 40) || rid(4), name: str(p.name, 80), desc: str(p.desc, 300), price: str(p.price, 40), link: /^https:\/\/\S+$/.test(str(p.link, 400)) ? str(p.link, 400) : "", grants: cleanAccess(p.grants) }),
  banners: (b) => ({ id: str(b.id, 40) || rid(4), title: str(b.title, 80), text: str(b.text, 200), cover: str(b.cover, 300), link: str(b.link, 300) }),
  educators: (e) => ({ id: str(e.id, 40) || rid(4), name: str(e.name, 80), academyId: str(e.academyId, 40), role: str(e.role, 80), bio: str(e.bio, 600), photo: str(e.photo, 300), email: str(e.email, 120).toLowerCase() }),
  modules: (m) => ({
    id: str(m.id, 40) || rid(4), title: str(m.title, 120), desc: str(m.desc, 400),
    academyId: str(m.academyId, 40), subId: str(m.subId, 40), educatorId: str(m.educatorId, 40), level: m.level === "premium" ? "premium" : "base", cover: str(m.cover, 300),
    lessons: (Array.isArray(m.lessons) ? m.lessons : []).slice(0, 100).map((l) => ({
      id: str(l.id, 40) || rid(4), title: str(l.title, 140), youtubeId: str(l.youtubeId, 20), video: str(l.video, 400), minutes: Math.max(0, Math.min(600, Number(l.minutes) || 0)), desc: str(l.desc, 1000), pdf: str(l.pdf, 300), quiz: cleanQuiz(l.quiz),
    })),
  }),
  lives: (l) => ({
    id: str(l.id, 40) || rid(4), educatorId: str(l.educatorId, 40), title: str(l.title, 140), desc: str(l.desc, 600),
    start: isNaN(Date.parse(l.start)) ? new Date().toISOString() : new Date(l.start).toISOString(),
    minutes: Math.max(1, Math.min(600, Number(l.minutes) || 60)), url: str(l.url, 300), replayUrl: str(l.replayUrl, 300),
  }),
};

// ---------- handler ----------

export async function handleAppApi(request, env) {
  const kv = env.ACADEMY_PROGRESS;
  if (!kv) return fail("Archivio dati non configurato", 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/app/, "") || "/";
  const method = request.method;

  // Caricamento diretto di video/foto delle storie: il file arriva così com'è (niente conversioni, poco calcolo).
  if (path === "/upload" && method === "POST") return uploadMedia(request, env, kv, url);
  if (path === "/stripe-webhook" && method === "POST") return stripeWebhook(request, env, kv);

  // Le richieste che scrivono devono essere JSON: blocca i form inviati da altri siti.
  let body = {};
  if (method === "POST") {
    if (!(request.headers.get("Content-Type") || "").includes("application/json")) return fail("Formato non valido", 415);
    try { body = await request.json(); } catch { return fail("Dati non validi"); }
  }

  // Immagini (pubbliche: foto profilo ed educatori)
  const img = path.match(/^\/img\/([a-f0-9]{8,40})$/);
  if (img && method === "GET") {
    const v = await kv.get(`app:img:${img[1]}`, { type: "arrayBuffer" });
    if (!v) return new Response("Not found", { status: 404 });
    return new Response(v, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }

  // PDF caricati dall'admin (pubblici, si condividono con chiunque)
  const file = path.match(/^\/file\/([a-f0-9]{8,40})$/);
  if (file && method === "GET") {
    const { value: v, metadata } = await kv.getWithMetadata(`app:file:${file[1]}`, { type: "arrayBuffer" });
    if (!v) return new Response("Not found", { status: 404 });
    const type = (metadata && metadata.type) || "application/pdf";
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable" };
    if (type === "application/pdf") headers["Content-Disposition"] = 'inline; filename="vendita-uno.pdf"';
    const range = (request.headers.get("Range") || "").match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const size = v.byteLength;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start); end = Math.min(size - 1, end);
      if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      return new Response(v.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(v, { headers });
  }

  // Verifica pubblica di un certificato (dal QR code stampato sul PDF)
  const cm = path.match(/^\/cert\/(VU-[A-F0-9]{6}-[A-F0-9]{4})$/);
  if (cm && method === "GET") {
    const c = await getJSON(kv, `app:cert:${cm[1]}`);
    return c ? json({ cert: c }) : fail("Certificato non trovato", 404);
  }

  if (path === "/register" && method === "POST") return register(body, kv, env);
  if (path === "/login" && method === "POST") return login(body, kv, env);
  if (path === "/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });

  // Da qui in poi serve essere loggati
  const uid = await readToken(request, env);
  const me = uid ? await getJSON(kv, `app:user:${uid}`) : null;
  if (!me) return fail("Non autenticato", 401);
  const isAdmin = me.role === "admin";

  if (path === "/me" && method === "GET") {
    const [content, progress, reminders, g] = await Promise.all([
      getContent(kv), getJSON(kv, `app:progress:${me.id}`, {}), getJSON(kv, `app:rem:${me.id}`, []), getGym(kv, me.id),
    ]);
    return json({ user: publicUser(me), content: contentFor(me, content), progress, reminders, gym: gymOut(g) });
  }

  if (path === "/profile" && method === "POST") {
    for (const f of ["name", "surname", "city", "agency", "phone"]) if (f in body) me[f] = str(body[f], 80);
    if (!me.name) return fail("Il nome è obbligatorio");
    await saveUser(kv, me);
    return json({ user: publicUser(me) });
  }

  if (path === "/avatar" && method === "POST") {
    const id = await storeImage(kv, body.dataUrl);
    if (!id) return fail("Immagine non valida o troppo grande");
    const oldUrl = me.avatar ? `/api/app/img/${me.avatar}` : "";
    me.avatar = id;
    await saveUser(kv, me);
    // Se è un educatore, la nuova foto va anche sul suo profilo educatore (se usava la foto profilo o non ne aveva una).
    const content = await getContent(kv);
    const edu = content.educators.find((e) => e.email && e.email === me.email);
    if (edu && (!edu.photo || edu.photo === oldUrl)) {
      edu.photo = `/api/app/img/${id}`;
      await putJSON(kv, "app:content", content);
    }
    // La vecchia foto si cancella solo se non la usa più nessun profilo.
    if (oldUrl && !content.educators.some((e) => e.photo === oldUrl)) await kv.delete(`app:img:${oldUrl.split("/").pop()}`);
    return json({ user: publicUser(me) });
  }

  if (path === "/password" && method === "POST") {
    const old = await hashPassword(str(body.old, 200), me.pass.salt, me.pass.iter);
    if (!safeEqual(old, me.pass.hash)) return fail("La password attuale non è corretta");
    if (str(body.password, 200).length < 8) return fail("La nuova password deve avere almeno 8 caratteri");
    const salt = rid(16);
    me.pass = { salt, iter: PBKDF2_ITER, hash: await hashPassword(str(body.password, 200), salt) };
    await saveUser(kv, me);
    return json({ ok: true });
  }

  if (path === "/admin-claim" && method === "POST") {
    if (await kv.get("app:adminClaimed")) return fail("Il codice amministratore è già stato usato. Chiedi a un admin di darti l'accesso.", 403);
    const rl = `app:rlc:${me.id}`, tries = Number(await kv.get(rl)) || 0;
    if (tries >= 5) return fail("Troppi tentativi. Riprova tra un'ora.", 429);
    const h = toHex(await crypto.subtle.digest("SHA-256", enc.encode(str(body.code, 40).toUpperCase())));
    if (!safeEqual(h, ADMIN_CLAIM_HASH)) {
      await kv.put(rl, String(tries + 1), { expirationTtl: 3600 });
      return fail("Codice non valido");
    }
    me.role = "admin";
    await saveUser(kv, me);
    await kv.put("app:adminClaimed", me.id);
    return json({ user: publicUser(me) });
  }

  if (path === "/progress" && method === "POST") {
    const p = await getJSON(kv, `app:progress:${me.id}`, {});
    const id = str(body.lessonId, 40);
    if (body.done) p[id] = now(); else delete p[id];
    await putJSON(kv, `app:progress:${me.id}`, p);
    // Punti solo la prima volta e solo per lezioni che esistono davvero.
    const content = body.done ? await getContent(kv) : null;
    const real = content && content.modules.some((m) => m.lessons.some((l) => l.id === id) && canCourse(me, m));
    const r = real ? await award(kv, me, XP.lesson, `les:${id}`) : { g: await getGym(kv, me.id), gained: 0 };
    return json({ progress: p, gained: r.gained, gym: gymOut(r.g) });
  }

  if (path === "/remind" && method === "POST") {
    let r = await getJSON(kv, `app:rem:${me.id}`, []);
    const id = str(body.liveId, 40);
    r = r.filter((x) => x !== id);
    if (body.on) r.push(id);
    await putJSON(kv, `app:rem:${me.id}`, r.slice(-200));
    return json({ reminders: r });
  }

  if (path === "/save" && method === "POST") {
    const id = str(body.courseId, 40);
    me.saved = (me.saved || []).filter((x) => x !== id);
    if (body.on) me.saved.push(id);
    await saveUser(kv, me);
    return json({ user: publicUser(me) });
  }

  if (path === "/follow" && method === "POST") {
    const id = str(body.educatorId, 40);
    me.following = (me.following || []).filter((x) => x !== id);
    if (body.on) me.following.push(id);
    await saveUser(kv, me);
    return json({ user: publicUser(me) });
  }

  // ----- community -----
  if (path.startsWith("/posts") && !canSee(me, "community")) return fail("La community è bloccata: sbloccala per entrare", 403);

  if (path === "/posts" && method === "GET") {
    const educatorId = str(url.searchParams.get("educator"), 40);
    const page = await kv.list({ prefix: "app:post:", limit: educatorId ? 200 : 40, cursor: url.searchParams.get("cursor") || undefined });
    let posts = (await Promise.all(page.keys.map((k) => getJSON(kv, k.name)))).filter(Boolean);
    if (educatorId) posts = posts.filter((p) => p.educatorId === educatorId);
    return json({ posts: posts.map((p) => postOut(p, me)), cursor: page.list_complete ? null : page.cursor });
  }

  if (path === "/posts" && method === "POST") {
    const text = str(body.text, 2000);
    if (text.length < 2) return fail("Scrivi qualcosa");
    let image = "";
    if (body.image) {
      image = await storeImage(kv, body.image, 900 * 1024);
      if (!image) return fail("Immagine non valida o troppo grande");
    }
    const content = await getContent(kv);
    const edu = content.educators.find((e) => e.email && e.email === me.email);
    const key = `app:post:${invTs()}_${rid(4)}`;
    const post = { key, uid: me.id, author: `${me.name} ${me.surname}`.trim(), avatar: me.avatar || "", role: me.role, educatorId: edu ? edu.id : "", city: me.city || "", text, image, at: now(), likes: [], comments: [] };
    await putJSON(kv, key, post);
    return json({ post: postOut(post, me) });
  }

  const pm = path.match(/^\/posts\/(app:post:[0-9]{13}_[a-f0-9]{8})\/(like|comment|delete)$/);
  if (pm && method === "POST") {
    const post = await getJSON(kv, pm[1]);
    if (!post) return fail("Post non trovato", 404);
    if (pm[2] === "like") {
      post.likes = post.likes.filter((x) => x !== me.id);
      if (body.on) post.likes.push(me.id);
    } else if (pm[2] === "comment") {
      const text = str(body.text, 1000);
      if (text.length < 1) return fail("Scrivi un commento");
      post.comments.push({ uid: me.id, author: `${me.name} ${me.surname}`.trim(), avatar: me.avatar || "", text, at: now() });
      if (post.uid !== me.id) await pushNotif(kv, post.uid, { title: `${me.name} ha commentato il tuo post`, text, link: "#/community", icon: "comment" });
      post.comments = post.comments.slice(-200);
    } else {
      if (post.uid !== me.id && !isAdmin) return fail("Non puoi eliminare questo post", 403);
      await kv.delete(pm[1]);
      if (post.image) await kv.delete(`app:img:${post.image}`);
      return json({ ok: true });
    }
    await putJSON(kv, pm[1], post);
    return json({ post: postOut(post, me) });
  }

  // ----- live dell'educatore (le gestisce lui dal suo profilo) -----
  if (path === "/edu/lives" && method === "POST") {
    if (me.role !== "educator" && me.role !== "admin") return fail("Solo per educatori", 403);
    const content = await getContent(kv);
    const edu = content.educators.find((e) => e.email && e.email === me.email);
    if (!edu) return fail("Il tuo account non è collegato a un profilo educatore. Chiedi all'amministratore.", 403);
    if (!Array.isArray(body.data)) return fail("Dati non validi");
    const mine = body.data.slice(0, 200).map(SECTIONS.lives).map((l) => ({ ...l, educatorId: edu.id }));
    const before = content.lives;
    content.lives = [...content.lives.filter((l) => l.educatorId !== edu.id), ...mine].sort((a, b) => a.start.localeCompare(b.start));
    await notifyLives(kv, before, content.lives, content.educators);
    await putJSON(kv, "app:content", content);
    return json({ content });
  }

  if (path === "/refcode" && method === "POST") {
    const err = await setRefCode(kv, me, body.code);
    if (err) return fail(err);
    return json({ user: publicUser(me), refCode: me.refCode });
  }

  // ----- storie (24 ore) -----
  if (path === "/stories" && method === "GET") {
    const keys = await listAll(kv, "app:story:", 300);
    const t = now();
    const list = (await Promise.all(keys.map((k) => getJSON(kv, k.name)))).filter((x) => x && t - x.at < 86400000);
    return json({ stories: list.sort((a, b) => a.at - b.at).map((x) => ({ ...x, mine: x.uid === me.id })) });
  }

  if (path === "/stories" && method === "POST") {
    const content = await getContent(kv);
    const edu = content.educators.find((e) => e.email && e.email === me.email);
    if (!edu && !isAdmin) return fail("Le storie le pubblicano gli educatori", 403);
    const TTL = 2 * 86400;
    let image = "", video = "";
    if (/^[a-f0-9]{24}$/.test(body.imageId || "")) image = body.imageId;
    else if (body.image) { image = await storeImage(kv, body.image, 900 * 1024, TTL); if (!image) return fail("Foto non valida o troppo grande"); }
    if (/^[a-f0-9]{24}$/.test(body.videoId || "")) video = body.videoId;
    else if (body.video) { video = await storeVideo(kv, body.video, TTL); if (!video) return fail("Video non valido o troppo grande"); }
    const text = str(body.text, 300);
    if (!image && !video && !text) return fail("Aggiungi una foto, un video o del testo");
    const bg = /^#[0-9a-f]{6}$/i.test(body.bg) ? body.bg : "#2f6bff";
    const key = `app:story:${String(now()).padStart(13, "0")}_${rid(4)}`;
    const story = { key, uid: me.id, eduId: edu ? edu.id : "", author: edu ? edu.name : "Vendita Uno", photo: edu ? edu.photo : "", image, video, text, bg, mirror: !!body.mirror && !!video, at: now() };
    await kv.put(key, JSON.stringify(story), { expirationTtl: 86400 + 3600 });
    return json({ story: { ...story, mine: true } });
  }

  const sm = path.match(/^\/stories\/(app:story:[0-9]{13}_[a-f0-9]{8})\/delete$/);
  if (sm && method === "POST") {
    const st = await getJSON(kv, sm[1]);
    if (!st) return fail("Storia non trovata", 404);
    if (st.uid !== me.id && !isAdmin) return fail("Non puoi eliminare questa storia", 403);
    await kv.delete(sm[1]);
    if (st.image) await kv.delete(`app:img:${st.image}`);
    if (st.video) await kv.delete(`app:file:${st.video}`);
    return json({ ok: true });
  }

  // ----- notifiche -----
  if (path === "/notifications" && method === "GET") {
    const [all, mine, read] = await Promise.all([getJSON(kv, "app:notif:all", []), getJSON(kv, `app:notif:u:${me.id}`, []), kv.get(`app:notifread:${me.id}`)]);
    const since = Math.max(Number(read) || 0, me.createdAt - 7 * 86400000);
    // Avvisi delle sezioni tolte (live, guadagni, notizie, educatori): non si mostrano più.
    const old = /^#\/(live|guadagni|notizie|educator|mie-live|percorso)/;
    const list = [...all, ...mine].filter((n) => !old.test(n.link || "")).sort((a, b) => b.at - a.at).slice(0, 60).map((n) => ({ ...n, unread: n.at > since }));
    return json({ notifications: list, unread: list.filter((n) => n.unread).length });
  }
  if (path === "/notifications/read" && method === "POST") {
    await kv.put(`app:notifread:${me.id}`, String(now()));
    return json({ ok: true });
  }

  // ----- rete e guadagni -----
  if (path === "/network" && method === "GET") {
    const users = await listAll(kv, "app:user:", 5000);
    const lvl1 = users.filter((k) => k.metadata && k.metadata.ref === me.id);
    const ids1 = new Set(lvl1.map((k) => k.name.slice(9)));
    const lvl2 = users.filter((k) => k.metadata && ids1.has(k.metadata.ref));
    const out = (k) => ({ id: k.name.slice(9), name: k.metadata.n, city: k.metadata.c, at: k.metadata.t, avatar: k.metadata.a });
    const saleKeys = await listAll(kv, "app:sale:", 3000);
    const sales = (await Promise.all(saleKeys.map((k) => getJSON(kv, k.name)))).filter(Boolean);
    const s1 = sales.filter((x) => x.referrerId === me.id), s2 = sales.filter((x) => x.referrer2Id === me.id);
    const sum = (l) => l.reduce((n, x) => n + x.amount, 0);
    return json({ refCode: me.refCode, level1: lvl1.map(out), level2: lvl2.map(out),
      sales: { direct: sum(s1), directCount: s1.length, level2: sum(s2), level2Count: s2.length, items: s1.slice(0, 50).map((x) => ({ at: x.at, buyer: x.buyerName, product: x.productName, amount: x.amount, currency: x.currency })) } });
  }

  if (path === "/zone" && method === "POST") {
    const comune = str(body.comune, 80), phone = str(body.phone, 30);
    if (!comune || phone.replace(/\D/g, "").length < 6) return fail("Inserisci comune e telefono");
    const key = `app:zone:${invTs()}_${rid(4)}`;
    await putJSON(kv, key, { key, uid: me.id, name: `${me.name} ${me.surname}`.trim(), email: me.email, comune, phone, note: str(body.note, 500), at: now() });
    return json({ ok: true });
  }

  // ----- allenamento -----
  const gymRes = await handleGym(path, method, body, me, kv, env, url);
  if (gymRes) return gymRes;

  // ----- admin -----
  if (path.startsWith("/admin/")) {
    if (!isAdmin) return fail("Solo per amministratori", 403);

    if (path === "/admin/users" && method === "GET") {
      // L'elenco di KV si aggiorna con qualche minuto di ritardo: per il ruolo si leggono i dati veri di ogni utente.
      const keys = await listAll(kv, "app:user:", 5000);
      const recs = [];
      for (let i = 0; i < keys.length; i += 50) recs.push(...(await Promise.all(keys.slice(i, i + 50).map((k) => getJSON(kv, k.name)))));
      const users = recs.filter(Boolean);
      const byId = Object.fromEntries(users.map((u) => [u.id, u]));
      const content = await getContent(kv);
      // Chi è stato messo Educatore prima che esistessero i profili collegati: il profilo si crea adesso.
      const missing = users.filter((u) => u.role === "educator" && !content.educators.some((e) => e.email && e.email === u.email));
      if (missing.length) {
        for (const u of missing) linkEducator(content, u);
        await putJSON(kv, "app:content", content);
      }
      return json({ content: missing.length ? content : undefined, users: users.map((u) => ({ access: Array.isArray(u.access) ? u.access : null, referredById: u.referredBy || "", id: u.id, name: `${u.name} ${u.surname}`.trim(), email: u.email, role: u.role, city: u.city || "", at: u.createdAt, refCode: u.refCode, referredBy: u.referredBy && byId[u.referredBy] ? `${byId[u.referredBy].name} ${byId[u.referredBy].surname}`.trim() : "", educatorId: (content.educators.find((e) => e.email && e.email === u.email) || {}).id || "" })).sort((a, b) => b.at - a.at) });
    }

    if (path === "/admin/role" && method === "POST") {
      const u = await getJSON(kv, `app:user:${str(body.id, 40)}`);
      if (!u) return fail("Utente non trovato", 404);
      if (!["agent", "educator", "admin"].includes(body.role)) return fail("Ruolo non valido");
      if (u.id === me.id && body.role !== "admin") return fail("Non puoi togliere l'accesso admin a te stesso");
      u.role = body.role;
      await saveUser(kv, u);
      let content = null;
      if (u.role === "agent") {
        // Non è più educatore: via il profilo collegato, le sue live e il collegamento ai corsi.
        content = await getContent(kv);
        const edu = content.educators.find((e) => e.email && e.email === u.email);
        if (edu) {
          content.educators = content.educators.filter((e) => e !== edu);
          content.lives = content.lives.filter((l) => l.educatorId !== edu.id);
          for (const m of content.modules) if (m.educatorId === edu.id) m.educatorId = "";
          await putJSON(kv, "app:content", content);
        }
      }
      if (u.role === "educator") {
        // Collega l'account al profilo educatore: stessa email, oppure stesso nome senza email, altrimenti ne crea uno nuovo.
        content = await getContent(kv);
        linkEducator(content, u, body.academyId, body.specialty);
        await pushNotif(kv, u.id, { title: "Sei un educatore di Vendita Uno", text: "Dal tuo profilo trovi \"Le mie live\": programmi le dirette o vai in diretta quando vuoi.", link: "#/mie-live", icon: "cap" });
        await putJSON(kv, "app:content", content);
      }
      return json({ ok: true, content });
    }

    if (path === "/admin/content" && method === "POST") {
      const section = str(body.section, 20);
      if (!SECTIONS[section] || !Array.isArray(body.data)) return fail("Sezione non valida");
      const content = await getContent(kv);
      const before = content[section] || [];
      content[section] = body.data.slice(0, 500).map(SECTIONS[section]);
      if (section === "lives") { content.lives.sort((a, b) => a.start.localeCompare(b.start)); await notifyLives(kv, before, content.lives, content.educators); }
      if (section === "modules") await notifyModules(kv, before, content.modules);
      if (section === "educators") {
        // Chi viene tolto dagli educatori torna Agente (gli admin restano admin).
        const kept = new Set(content.educators.map((e) => e.email).filter(Boolean));
        for (const e of before) {
          if (!e.email || kept.has(e.email)) continue;
          const uid = await kv.get(`app:email:${e.email}`);
          const u = uid ? await getJSON(kv, `app:user:${uid}`) : null;
          if (u && u.role === "educator") { u.role = "agent"; await saveUser(kv, u); }
        }
        // Chi viene collegato a un profilo educatore diventa Educatore (gli admin restano admin).
        for (const e of content.educators) {
          if (!e.email) continue;
          const uid = await kv.get(`app:email:${e.email}`);
          const u = uid ? await getJSON(kv, `app:user:${uid}`) : null;
          if (u && u.role === "agent") {
            u.role = "educator";
            await saveUser(kv, u);
            await pushNotif(kv, u.id, { title: "Sei un educatore di Vendita Uno", text: "Dal tuo profilo trovi \"Le mie live\": programmi le dirette o vai in diretta quando vuoi.", link: "#/mie-live", icon: "cap" });
          }
        }
        const ids = new Set(content.educators.map((e) => e.id));
        content.lives = content.lives.filter((l) => ids.has(l.educatorId));
        for (const m of content.modules) if (m.educatorId && !ids.has(m.educatorId)) m.educatorId = "";
      }
      await putJSON(kv, "app:content", content);
      return json({ content });
    }

    if (path === "/admin/settings" && method === "POST") {
      const content = await getContent(kv);
      for (const k of Object.keys(defaultSettings())) if (k in body) content.settings[k] = str(body[k], 400);
      await putJSON(kv, "app:content", content);
      return json({ content });
    }

    if (path === "/admin/access" && method === "POST") {
      const u = await getJSON(kv, `app:user:${str(body.id, 40)}`);
      if (!u) return fail("Utente non trovato", 404);
      u.access = cleanAccess(body.access);
      await saveUser(kv, u);
      return json({ ok: true, access: u.access });
    }

    if (path === "/admin/sales" && method === "GET") {
      const keys = await listAll(kv, "app:sale:", 5000);
      return json({ sales: (await Promise.all(keys.map((k) => getJSON(kv, k.name)))).filter(Boolean) });
    }

    if (path === "/admin/sales" && method === "POST") {
      // Vendita registrata a mano (bonifico, contanti…): sblocca e attribuisce come quelle Stripe
      const content = await getContent(kv);
      const product = (content.products || []).find((p) => p.id === body.productId);
      if (!product) return fail("Scegli il prodotto");
      const buyer = await getJSON(kv, `app:user:${str(body.buyerId, 40)}`);
      if (!buyer) return fail("Scegli chi ha acquistato");
      const sale = await recordSale(kv, { buyerId: buyer.id, product, amount: Math.round(Number(String(body.amount).replace(",", ".")) * 100), currency: "eur", source: "manuale" });
      return json({ sale });
    }

    const sd = path.match(/^\/admin\/sales\/(app:sale:[0-9]{13}_[a-f0-9]{8})\/delete$/);
    if (sd && method === "POST") {
      await kv.delete(sd[1]);
      return json({ ok: true });
    }

    if (path === "/admin/refcode" && method === "POST") {
      const u = await getJSON(kv, `app:user:${str(body.id, 40)}`);
      if (!u) return fail("Utente non trovato", 404);
      const err = await setRefCode(kv, u, body.code);
      if (err) return fail(err);
      return json({ refCode: u.refCode });
    }

    if (path === "/admin/notify" && method === "POST") {
      const title = str(body.title, 120);
      if (!title) return fail("Scrivi il titolo dell'avviso");
      await pushNotif(kv, "all", { title, text: body.text, link: body.link, icon: "mega" });
      return json({ ok: true });
    }

    if (path === "/admin/file" && method === "POST") {
      const m = typeof body.dataUrl === "string" && body.dataUrl.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return fail("Carica un file PDF");
      const bin = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
      if (bin.length > 12 * 1024 * 1024) return fail("Il PDF è troppo grande (massimo 12 MB)");
      if (String.fromCharCode(...bin.slice(0, 4)) !== "%PDF") return fail("Il file non è un PDF valido");
      const id = rid(12);
      await kv.put(`app:file:${id}`, bin);
      return json({ url: `/api/app/file/${id}` });
    }

    if (path === "/admin/image" && method === "POST") {
      const id = await storeImage(kv, body.dataUrl, 900 * 1024);
      if (!id) return fail("Immagine non valida o troppo grande");
      return json({ url: `/api/app/img/${id}` });
    }

    if (path === "/admin/zones" && method === "GET") {
      const keys = await listAll(kv, "app:zone:", 500);
      return json({ zones: (await Promise.all(keys.map((k) => getJSON(kv, k.name)))).filter(Boolean) });
    }
  }

  return fail("Non trovato", 404);
}

// Collega l'account al profilo educatore: stessa email, oppure stesso nome senza email, altrimenti ne crea uno nuovo.
function linkEducator(content, u, academyId, specialty) {
  const full = `${u.name} ${u.surname}`.trim(), norm = (x) => (x || "").trim().toLowerCase();
  let edu = content.educators.find((e) => e.email && e.email === u.email) || content.educators.find((e) => !e.email && norm(e.name) === norm(full));
  if (edu) edu.email = u.email;
  else {
    edu = { id: rid(4), name: full, academyId: (content.academies[0] || {}).id || "", role: "", bio: "", photo: u.avatar ? `/api/app/img/${u.avatar}` : "", email: u.email };
    content.educators.push(edu);
  }
  if (academyId && content.academies.some((a) => a.id === academyId)) edu.academyId = academyId;
  if (specialty) edu.role = str(specialty, 80);
  return edu;
}

// Cambia il codice del link invito. Il vecchio codice resta valido, così i link già condivisi funzionano ancora.
async function setRefCode(kv, u, raw) {
  const code = str(raw, 30).toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return "Usa da 3 a 20 caratteri: lettere, numeri, - o _";
  if (code === u.refCode) return null;
  const owner = await kv.get(`app:ref:${code}`);
  if (owner && owner !== u.id) return "Questo link è già usato da un'altra persona";
  await kv.put(`app:ref:${code}`, u.id);
  u.refCode = code;
  await saveUser(kv, u);
  return null;
}

// ---------- accessi a pagamento ----------
// user.access: assente = utente registrato prima dei blocchi (vede tutto); altrimenti elenco di permessi:
// "all", "live", "community", "educators", "acad:<id>", "course:<id>". Admin ed educatori vedono sempre tutto.
const ACCESS_RE = /^(all|live|community|educators|acad:[\w-]{1,40}|course:[\w-]{1,40})$/;
const cleanAccess = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => str(x, 50)).filter((x) => ACCESS_RE.test(x)))];
function fullAccess(u) { return u.role === "admin" || u.role === "educator" || !Array.isArray(u.access) || u.access.includes("all"); }
function canSee(u, what) { return fullAccess(u) || u.access.includes(what); }
function canCourse(u, m) { return fullAccess(u) || u.access.includes(`course:${m.id}`) || u.access.includes(`acad:${m.academyId}`); }
// Contenuti per l'utente: i video e i link dei contenuti bloccati non vengono inviati.
function contentFor(u, c) {
  if (u.role === "admin") return c;
  // Le risposte dei quiz arrivano mescolate: la giusta non è più la prima.
  const withQuiz = (m) => ({ ...m, lessons: m.lessons.map((l) => ({ ...l, quiz: quizForStudent(l.quiz) })) });
  if (fullAccess(u)) return { ...c, modules: c.modules.map(withQuiz) };
  const live = canSee(u, "live");
  return {
    ...c,
    modules: c.modules.map((m) => (canCourse(u, m) ? withQuiz(m) : { ...m, lessons: m.lessons.map((l) => ({ ...l, video: "", youtubeId: "", pdf: "", quiz: (l.quiz || []).map(() => ({ q: "", opts: [] })) })) })),
    lives: live ? c.lives : c.lives.map((l) => ({ ...l, url: "", replayUrl: "" })),
  };
}

// ---------- vendite (Stripe e manuali) ----------
async function recordSale(kv, { buyerId, product, amount, currency, source, sessionId }) {
  if (sessionId) {
    if (await kv.get(`app:salesess:${sessionId}`)) return null; // già registrata (Stripe a volte invia due volte)
    await kv.put(`app:salesess:${sessionId}`, "1", { expirationTtl: 90 * 86400 });
  }
  const buyer = buyerId ? await getJSON(kv, `app:user:${buyerId}`) : null;
  const ref1 = buyer && buyer.referredBy ? await getJSON(kv, `app:user:${buyer.referredBy}`) : null;
  const ref2 = ref1 && ref1.referredBy ? await getJSON(kv, `app:user:${ref1.referredBy}`) : null;
  const nm = (u) => (u ? `${u.name} ${u.surname}`.trim() : "");
  const key = `app:sale:${invTs()}_${rid(4)}`;
  const sale = { key, at: now(), source, sessionId: sessionId || "", productId: product ? product.id : "", productName: product ? product.name : "", amount: Math.round(Number(amount) || 0), currency: (currency || "eur").toLowerCase(),
    buyerId: buyer ? buyer.id : "", buyerName: nm(buyer), buyerEmail: buyer ? buyer.email : "",
    referrerId: ref1 ? ref1.id : "", referrerName: nm(ref1), referrerCode: ref1 ? ref1.refCode : "", referrer2Id: ref2 ? ref2.id : "", referrer2Name: nm(ref2) };
  await putJSON(kv, key, sale);
  // Sblocca quello che il prodotto comprende
  if (buyer && product && product.grants.length) {
    buyer.access = Array.isArray(buyer.access) ? cleanAccess([...buyer.access, ...product.grants]) : buyer.access;
    await saveUser(kv, buyer);
    await pushNotif(kv, buyer.id, { title: "Acquisto completato", text: `${product.name}: i contenuti sono sbloccati.`, link: "#/accademia", icon: "check" });
  }
  if (ref1) await pushNotif(kv, ref1.id, { title: "Nuova vendita dal tuo link", text: `${nm(buyer) || "Un cliente"} ha acquistato ${product ? product.name : "un prodotto"}.`, link: "#/guadagni", icon: "euro" });
  return sale;
}

// Verifica la firma che Stripe mette su ogni avviso (webhook).
async function stripeVerify(raw, header, secret) {
  const parts = Object.fromEntries((header || "").split(",").map((x) => x.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = (header || "").split(",").filter((x) => x.trim().startsWith("v1=")).map((x) => x.trim().slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const expected = await hmac(`${parts.t}.${raw}`, secret);
  return sigs.some((sg) => safeEqual(sg, expected));
}

async function stripeWebhook(request, env, kv) {
  if (!env.STRIPE_WEBHOOK_SECRET) return fail("Webhook Stripe non configurato", 500);
  const raw = await request.text();
  if (!(await stripeVerify(raw, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) return fail("Firma non valida", 400);
  let ev;
  try { ev = JSON.parse(raw); } catch { return fail("Dati non validi"); }
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    const ses = ev.data && ev.data.object ? ev.data.object : {};
    if (ses.payment_status && ses.payment_status !== "paid" && ev.type === "checkout.session.completed") return json({ ok: true, waiting: true });
    // client_reference_id = "<idUtente>__<idProdotto>", messo dall'app sul link di pagamento
    const [buyerId, productId] = String(ses.client_reference_id || "").split("__");
    const content = await getContent(kv);
    const product = (content.products || []).find((p) => p.id === productId) || null;
    let bid = /^[a-f0-9]{16}$/.test(buyerId || "") ? buyerId : "";
    if (!bid && ses.customer_details && ses.customer_details.email) bid = (await kv.get(`app:email:${String(ses.customer_details.email).toLowerCase()}`)) || "";
    await recordSale(kv, { buyerId: bid, product, amount: ses.amount_total, currency: ses.currency, source: "stripe", sessionId: ses.id });
  }
  return json({ received: true });
}

// ---------- notifiche ----------
// Generali (per tutti): app:notif:all. Personali: app:notif:u:<id>. Letto fino a: app:notifread:<id>.
async function pushNotif(kv, target, n) {
  const key = target === "all" ? "app:notif:all" : `app:notif:u:${target}`;
  const list = await getJSON(kv, key, []);
  list.unshift({ id: rid(6), at: now(), title: str(n.title, 120), text: str(n.text, 300), link: str(n.link, 200), icon: str(n.icon, 20) || "bell" });
  await putJSON(kv, key, list.slice(0, 60));
}
const fmtDate = (iso) => new Date(iso).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
// Confronta live prima/dopo un salvataggio e avvisa tutti delle novità.
async function notifyLives(kv, before, after, educators) {
  const old = new Set(before.map((l) => l.id)), t = now();
  for (const l of after) {
    if (old.has(l.id)) continue;
    const e = educators.find((x) => x.id === l.educatorId), who = e ? ` con ${e.name}` : "";
    const start = new Date(l.start).getTime();
    if (start <= t + 120000 && start + l.minutes * 60000 > t) await pushNotif(kv, "all", { title: `In diretta ora${who}`, text: l.title, link: `#/live/${l.id}`, icon: "live" });
    else if (start > t) await pushNotif(kv, "all", { title: `Nuova live${who}`, text: `${l.title} · ${fmtDate(l.start)}`, link: `#/live/${l.id}`, icon: "cal" });
  }
}
async function notifyModules(kv, before, after) {
  for (const m of after) {
    const o = before.find((x) => x.id === m.id);
    if (!o) await pushNotif(kv, "all", { title: "Nuovo corso", text: m.title, link: `#/corso/${m.id}`, icon: "cap" });
    else if (m.lessons.length > o.lessons.length) {
      const n = m.lessons.length - o.lessons.length;
      await pushNotif(kv, "all", { title: n === 1 ? "Nuova lezione" : `${n} nuove lezioni`, text: m.title, link: `#/corso/${m.id}`, icon: "play" });
    }
  }
}

function postOut(p, me) {
  return { key: p.key, author: p.author, avatar: p.avatar, role: p.role, educatorId: p.educatorId, city: p.city, text: p.text, image: p.image || "", at: p.at, likes: p.likes.length, liked: p.likes.includes(me.id), comments: p.comments, mine: p.uid === me.id };
}

async function storeImage(kv, dataUrl, maxBytes = MAX_IMG_BYTES, ttl = 0) {
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const bin = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  if (bin.length > maxBytes || bin[0] !== 0xff || bin[1] !== 0xd8) return null;
  const id = rid(12);
  await kv.put(`app:img:${id}`, bin, ttl ? { expirationTtl: ttl } : undefined);
  return id;
}

// File caricati per le storie: il corpo della richiesta è il file stesso (video/mp4, video/webm, video/quicktime, image/jpeg).
// I tipi video/* e image/* non possono essere inviati da form di altri siti senza permesso, quindi la richiesta è sicura.
async function uploadMedia(request, env, kv, url) {
  const uid = await readToken(request, env);
  const me = uid ? await getJSON(kv, `app:user:${uid}`) : null;
  if (!me) return fail("Non autenticato", 401);
  const content = await getContent(kv);
  if (me.role !== "admin" && !content.educators.some((e) => e.email && e.email === me.email)) return fail("Le storie le pubblicano gli educatori", 403);
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (type === "application/pdf") {
    // PDF di presentazione: solo l'admin, file permanente
    if (me.role !== "admin") return fail("Solo per amministratori", 403);
    const pdf = await request.arrayBuffer();
    if (pdf.byteLength > 20 * 1024 * 1024) return fail("Il PDF è troppo grande (massimo 20 MB)");
    if (String.fromCharCode(...new Uint8Array(pdf.slice(0, 4))) !== "%PDF") return fail("Il file non è un PDF valido");
    const pid = rid(12);
    await kv.put(`app:file:${pid}`, pdf, { metadata: { type } });
    return json({ id: pid, url: `/api/app/file/${pid}` });
  }
  const isVideo = ["video/mp4", "video/webm", "video/quicktime"].includes(type), isImage = type === "image/jpeg";
  if (!isVideo && !isImage) return fail("Formato non supportato: usa un video (mp4, mov, webm) o una foto", 415);
  const len = Number(request.headers.get("Content-Length") || 0), max = isVideo ? 24 * 1024 * 1024 : 3 * 1024 * 1024;
  if (len > max) return fail(isVideo ? "Il video è troppo grande (massimo 24 MB): registrane uno più breve" : "Foto troppo grande");
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return fail("File vuoto");
  if (buf.byteLength > max) return fail(isVideo ? "Il video è troppo grande (massimo 24 MB): registrane uno più breve" : "Foto troppo grande");
  const id = rid(12), TTL = 2 * 86400;
  if (isVideo) await kv.put(`app:file:${id}`, buf, { expirationTtl: TTL, metadata: { type } });
  else await kv.put(`app:img:${id}`, buf, { expirationTtl: TTL });
  return json({ id, kind: isVideo ? "video" : "image" });
}

// Video delle storie (mp4/webm/mov), salvati come file che scadono da soli.
async function storeVideo(kv, dataUrl, ttl) {
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:(video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bin.length > 15 * 1024 * 1024) return null;
  const id = rid(12);
  await kv.put(`app:file:${id}`, bin, { expirationTtl: ttl, metadata: { type: m[1] } });
  return id;
}

async function register(body, kv, env) {
  const email = str(body.email, 120).toLowerCase();
  const password = str(body.password, 200);
  const name = str(body.name, 60), surname = str(body.surname, 60);
  if (!name || !surname) return fail("Inserisci nome e cognome");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail("Email non valida");
  if (password.length < 8) return fail("La password deve avere almeno 8 caratteri");
  if (await kv.get(`app:email:${email}`)) return fail("Esiste già un account con questa email. Accedi.");

  let referredBy = "";
  const ref = str(body.ref, 20).toUpperCase();
  if (ref) referredBy = (await kv.get(`app:ref:${ref}`)) || "";

  let refCode;
  do refCode = rid(3).toUpperCase(); while (await kv.get(`app:ref:${refCode}`));

  const salt = rid(16);
  const user = {
    id: rid(8), email, name, surname,
    city: str(body.city, 80), agency: str(body.agency, 80), phone: str(body.phone, 30),
    role: isAdminEmail(email, env) ? "admin" : "agent",
    refCode, referredBy, following: [], avatar: "", createdAt: now(), access: [],
    pass: { salt, iter: PBKDF2_ITER, hash: await hashPassword(password, salt) },
  };
  await saveUser(kv, user);
  await kv.put(`app:email:${email}`, user.id);
  if (referredBy) await pushNotif(kv, referredBy, { title: `${name} ${surname} si è iscritto con il tuo link`, text: "Ora fa parte della tua rete.", link: "#/guadagni", icon: "users" });
  await kv.put(`app:ref:${refCode}`, user.id);
  const token = await makeToken(user.id, env);
  return json({ user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

async function login(body, kv, env) {
  const email = str(body.email, 120).toLowerCase();
  const rlKey = `app:rl:${email}`;
  const attempts = Number(await kv.get(rlKey)) || 0;
  if (attempts >= 8) return fail("Troppi tentativi. Riprova tra 15 minuti.", 429);

  const uid = await kv.get(`app:email:${email}`);
  const user = uid ? await getJSON(kv, `app:user:${uid}`) : null;
  const ok = user && safeEqual(await hashPassword(str(body.password, 200), user.pass.salt, user.pass.iter), user.pass.hash);
  if (!ok) {
    await kv.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
    return fail("Email o password non corretti", 401);
  }
  if (isAdminEmail(email, env) && user.role !== "admin") {
    user.role = "admin";
    await saveUser(kv, user);
  }
  const token = await makeToken(user.id, env);
  return json({ user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

// =====================================================================
// ALLENAMENTO: punti, giorni di fila, classifica, quiz, certificati,
// risultati, muro dei successi e simulatore di chiamate con l'AI.
// =====================================================================
// Chiavi KV:
//   app:xp:<uid>        punti, giorni attivi, premi già dati (once)
//   app:lb:<lunedì>     classifica della settimana { uid: { n, a, c, x } }
//   app:res:<uid>       risultati di lavoro per giorno { "2026-11-13": { c, a, m, s } }
//   app:win:<ts>_<id>   un successo nel muro
//   app:cert:<codice>   certificato (pubblico, si verifica dal QR)
// Simulatore: serve la variabile segreta ANTHROPIC_API_KEY (Cloudflare → Workers → Impostazioni → Variabili).

const SIM_MODEL = "claude-opus-5-5";
const SIM_PER_DAY = 8; // telefonate valutate al giorno per persona
const SIM_TURNS_PER_DAY = 160; // battute al giorno per persona (protegge i costi)
const SIM_MAX_TURNS = 30; // battute in una telefonata

const XP = { lesson: 20, quiz: 30, quizPerfect: 10, results: 10, win: 25 };

const dayKey = (t = now()) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
function weekKey(t = now()) {
  const d = new Date(`${dayKey(t)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function streakOf(days) {
  const set = new Set(days);
  const d = new Date(`${dayKey()}T12:00:00Z`);
  if (!set.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1); // oggi non è ancora finito
  let n = 0;
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}
function gymOut(g) {
  const streak = streakOf(g.days || []);
  const d = dayKey();
  return { xp: g.xp || 0, streak, best: Math.max(g.best || 0, streak), today: (g.days || []).includes(d), days: (g.days || []).slice(-42), quiz: g.quiz || {},
    simToday: (g.sims || []).filter((x) => dayKey(x.at) === d).length, resToday: !!(g.once || {})[`res:${d}`] };
}
const getGym = (kv, uid) => getJSON(kv, `app:xp:${uid}`, { xp: 0, days: [], once: {}, quiz: {} });

// Dà i punti (una volta sola se c'è onceKey), segna il giorno attivo e aggiorna la classifica della settimana.
async function award(kv, me, pts, onceKey, g) {
  g = g || (await getGym(kv, me.id));
  g.once = g.once || {};
  if (onceKey && g.once[onceKey]) return { g, gained: 0 };
  if (onceKey) g.once[onceKey] = 1;
  g.xp = (g.xp || 0) + pts;
  const d = dayKey();
  if (!(g.days || []).includes(d)) g.days = [...(g.days || []), d].slice(-400);
  g.best = Math.max(g.best || 0, streakOf(g.days));
  await putJSON(kv, `app:xp:${me.id}`, g);
  if (pts > 0) {
    const wk = `app:lb:${weekKey()}`;
    const lb = await getJSON(kv, wk, {});
    const r = lb[me.id] || { x: 0 };
    lb[me.id] = { n: `${me.name} ${me.surname}`.trim(), a: me.avatar || "", c: me.city || "", x: r.x + pts };
    await putJSON(kv, wk, lb, { expirationTtl: 70 * 86400 });
  }
  return { g, gained: pts };
}

// ---------- quiz ----------
// Nei dati la prima risposta è quella giusta; agli studenti arrivano mescolate.
function cleanQuiz(q) {
  return (Array.isArray(q) ? q : []).slice(0, 10).map((x) => ({
    q: str(x && x.q, 300),
    opts: (Array.isArray(x && x.opts) ? x.opts : []).slice(0, 5).map((o) => str(o, 200)).filter(Boolean),
  })).filter((x) => x.q && x.opts.length >= 2);
}
function shuffled(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
const quizForStudent = (quiz) => (quiz || []).map((x) => ({ q: x.q, opts: shuffled(x.opts) }));

// ---------- simulatore ----------
const SIM_SCENARIOS = [
  { id: "freddo", academy: "agenti", level: 1, who: "Paolo Ferri", role: "Ha messo in vendita il trilocale su un portale", title: "Chiamata a freddo dall'annuncio", goal: "Fissa un appuntamento per vedere la casa", opener: "Pronto? Chi parla?",
    persona: "Sei Paolo Ferri, 52 anni, impiegato a Bergamo. Hai messo da 10 giorni il tuo trilocale (95 mq, terzo piano senza ascensore) su un portale come privato a 245.000 euro. Ti hanno già chiamato 6 agenzie, sei un po' stufo ma educato. Hai fretta perché sei in pausa pranzo. Non hai ancora ricevuto nessuna proposta seria e un po' ti preoccupa. Ti convince chi ti fa domande sulla tua situazione invece di vendere se stesso, e chi ti propone qualcosa di concreto e breve (es. 20 minuti per darti una valutazione con i dati delle vendite vere della zona)." },
  { id: "privato", academy: "agenti", level: 2, who: "Giovanna Russo", role: "Vuole vendere casa da sola", title: "«Vendo da sola, niente agenzie»", goal: "Ottieni un incontro di persona senza litigare",
    opener: "Sì, pronto?",
    persona: "Sei Giovanna Russo, 61 anni, pensionata a Napoli (Vomero). Vendi la casa della madre scomparsa, 110 mq, chiedi 420.000 euro. Sei convinta che le agenzie prendano soldi per niente: tua cugina ha pagato il 4% per una vendita fatta in un mese. Rispondi secca all'inizio. In realtà hai paura di sbagliare con documenti, eredità e successione (non hai ancora fatto la voltura catastale) e da 2 mesi ricevi solo curiosi. Ti apri se l'agente ti chiede del perché vendi e delle visite fatte finora, e se tocca il tema documenti/sicurezza senza spaventarti." },
  { id: "giaagenzia", academy: "agenti", level: 3, who: "Marco Bianchi", role: "Ha già un incarico con un'altra agenzia", title: "«Ho già un'agenzia»", goal: "Fatti richiamare quando scade l'incarico, con una data precisa",
    opener: "Pronto, chi è?",
    persona: "Sei Marco Bianchi, 45 anni, ingegnere a Torino. Hai firmato 4 mesi fa un incarico in esclusiva di 6 mesi con un'agenzia per la tua villetta a schiera (prezzo 380.000). Hai avuto 3 visite, nessuna proposta, l'agente si fa sentire poco. Scade il 15 del mese prossimo. Sei leale e all'inizio chiudi subito ('sono già con un'agenzia, grazie'). Non dici la data di scadenza se non te la chiedono bene. Ti dà fastidio chi parla male dell'altra agenzia. Ti convince chi è rispettoso e ti fa ragionare su cosa non sta funzionando." },
  { id: "provvigione", academy: "agenti", level: 3, who: "Luca Moretti", role: "Proprietario pronto a firmare, ma tratta", title: "«Il 3% è troppo»", goal: "Difendi la provvigione e porta a casa l'incarico",
    opener: "Allora, ci ho pensato. Prima di firmare però dobbiamo parlare della provvigione.",
    persona: "Sei Luca Moretti, 48 anni, commerciante a Milano. Vendi un bilocale in zona Isola valutato 360.000. L'agente al telefono ti ha già fatto la valutazione e ti è piaciuto. Ora dici che il 3% è troppo: un'altra agenzia ti fa l'1,5%. È in parte vero, ma quell'agenzia non fa foto professionali né pubblicità a pagamento. Se l'agente cede subito allo sconto, lo rispetti meno e chiedi ancora di più. Ti convince chi ti mostra quanto vale il suo lavoro in euro (prezzo finale più alto, tempi più brevi) con calma e sicurezza." },
  { id: "prezzo", academy: "agenti", level: 2, who: "Anna Galli", role: "Vuole un prezzo troppo alto", title: "Prezzo fuori mercato", goal: "Fai accettare un prezzo realistico di partenza",
    opener: "Pronto? Ah sì, l'agente per la casa. Mi dica.",
    persona: "Sei Anna Galli, 57 anni, insegnante a Bologna. Vuoi vendere il tuo quadrilocale a 520.000 euro perché 'ci abbiamo messo tanti soldi nella ristrutturazione' (cucina nuova nel 2015). Le vendite vere in zona sono intorno a 410-430.000. Sei emotiva sulla casa. Ti offendi se l'agente dice che la casa vale poco. Ti convinci se ti fa vedere i dati delle vendite reali e ti fa capire cosa succede a una casa che resta mesi sul mercato." },
];
const scenarioOut = (s) => ({ id: s.id, academy: s.academy, level: s.level, who: s.who, role: s.role, title: s.title, goal: s.goal, opener: s.opener });

function simSystem(s) {
  return `Questa è una simulazione di allenamento al telefono per professionisti immobiliari italiani (app Vendita Uno). Tu interpreti un personaggio; l'utente è il professionista che ti sta chiamando.

Il tuo personaggio:
${s.persona}

La telefonata è già iniziata e tu hai risposto: «${s.opener}»
Obiettivo del professionista (tu non lo sai, ma serve a capire quando cedere): ${s.goal}.

Come rispondere:
- Resta sempre nel personaggio. Non dire mai di essere un'intelligenza artificiale e non dare consigli al professionista.
- Parla come una persona vera al telefono: italiano colloquiale, frasi brevi, di solito 1-3 frasi. Niente elenchi, niente emoji, niente descrizioni di azioni.
- Sii realistico: all'inizio hai le tue resistenze. Apriti un po' alla volta solo quando il professionista fa bene (ascolta, fa domande, dà valore concreto, gestisce le obiezioni senza insistere). Se è insistente, generico o maleducato, diventa più freddo.
- Se il professionista raggiunge l'obiettivo in modo convincente, accetta in modo naturale e aggiungi alla fine il segno [OBIETTIVO].
- Se ti irrita davvero o la telefonata non ha più senso, saluta e chiudi aggiungendo alla fine il segno [RIATTACCA].`;
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    voto: { type: "integer", description: "Da 0 a 100" },
    obiettivo: { type: "boolean" },
    sintesi: { type: "string" },
    puntiForti: { type: "array", items: { type: "string" } },
    errori: { type: "array", items: { type: "string" } },
    fraseMigliore: { type: "string" },
    fraseDaRifare: { type: "string" },
    comeDirla: { type: "string" },
    consiglio: { type: "string" },
  },
  required: ["voto", "obiettivo", "sintesi", "puntiForti", "errori", "fraseMigliore", "fraseDaRifare", "comeDirla", "consiglio"],
  additionalProperties: false,
};

function scoreSystem(s) {
  return `Sei un formatore esperto di vendita immobiliare in Italia e alleni i professionisti dell'app Vendita Uno. Valuti una telefonata di allenamento con un cliente simulato.

Scenario: ${s.title}. Cliente: ${s.who} (${s.role.toLowerCase()}).
Obiettivo del professionista: ${s.goal}.

Valuta con onestà, come un allenatore esigente ma che vuole far crescere la persona:
- voto: da 0 a 100. 90+ solo per telefonate davvero eccellenti; sotto 50 se ha sbagliato approccio.
- obiettivo: true solo se l'obiettivo è stato raggiunto davvero.
- sintesi: 1-2 frasi su com'è andata.
- puntiForti: da 1 a 3 cose fatte bene, concrete (cita cosa ha detto).
- errori: da 1 a 3 errori concreti, ognuno con il perché.
- fraseMigliore: la frase migliore detta dal professionista, citata alla lettera.
- fraseDaRifare: la frase più debole detta dal professionista, citata alla lettera.
- comeDirla: come avrebbe potuto dire meglio quella frase, pronta da usare.
- consiglio: un solo consiglio pratico per la prossima telefonata.
Scrivi in italiano semplice, dando del tu. Le frasi citate devono essere del professionista, non del cliente.`;
}

async function callClaude(env, system, messages, extra = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({ model: SIM_MODEL, max_tokens: 4000, system, messages, fallbacks: "default", ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Errore ${res.status}`);
  if (data.stop_reason === "refusal") throw new Error("refusal");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

// La conversazione arriva dal telefono: si ripulisce e deve alternare professionista / cliente.
function simHistory(raw) {
  const h = (Array.isArray(raw) ? raw : []).slice(-SIM_MAX_TURNS * 2).map((m) => ({ role: m && m.role === "assistant" ? "assistant" : "user", content: str(m && m.text, 700) })).filter((m) => m.content);
  const out = [];
  for (const m of h) {
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n" + m.content;
    else out.push(m);
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function simQuota(kv, me, kind) {
  const key = `app:simq:${me.id}:${dayKey()}`;
  const q = await getJSON(kv, key, { t: 0, s: 0 });
  if (kind === "turn" && q.t >= SIM_TURNS_PER_DAY) return "Per oggi hai finito le battute del simulatore. Riprova domani.";
  if (kind === "score" && q.s >= SIM_PER_DAY) return `Hai già fatto ${SIM_PER_DAY} telefonate oggi. Riposa la voce e riprova domani.`;
  q[kind === "turn" ? "t" : "s"]++;
  await putJSON(kv, key, q, { expirationTtl: 2 * 86400 });
  return "";
}

const winOut = (w, me) => ({ key: w.key, author: w.author, avatar: w.avatar, city: w.city, kind: w.kind, text: w.text, at: w.at, claps: w.claps.length, clapped: w.claps.includes(me.id), mine: w.uid === me.id });
const WIN_KINDS = ["incarico", "vendita", "appuntamento", "affitto", "altro"];

async function handleGym(path, method, body, me, kv, env, url) {
  const isAdmin = me.role === "admin";

  if (path === "/gym" && method === "GET") {
    const [g, res] = await Promise.all([getGym(kv, me.id), getJSON(kv, `app:res:${me.id}`, {})]);
    return json({ gym: gymOut(g), results: res, scenarios: SIM_SCENARIOS.map(scenarioOut), simReady: !!env.ANTHROPIC_API_KEY, certs: me.certs || {}, sims: (g.sims || []).slice(-20) });
  }

  if (path === "/gym/board" && method === "GET") {
    const prev = url.searchParams.get("week") === "prev";
    const t = prev ? now() - 7 * 86400000 : now();
    const lb = await getJSON(kv, `app:lb:${weekKey(t)}`, {});
    const all = Object.entries(lb).map(([id, r]) => ({ id, name: r.n, avatar: r.a, city: r.c, xp: r.x, me: id === me.id })).sort((a, b) => b.xp - a.xp);
    const rank = all.findIndex((x) => x.me) + 1;
    return json({ week: weekKey(t), list: all.slice(0, 50), rank, total: all.length });
  }

  if (path === "/quiz" && method === "POST") {
    const content = await getContent(kv);
    const id = str(body.lessonId, 40);
    const m = content.modules.find((x) => x.lessons.some((l) => l.id === id));
    const l = m && m.lessons.find((x) => x.id === id);
    if (!l || !(l.quiz || []).length) return fail("Quiz non trovato", 404);
    if (!canCourse(me, m)) return fail("Corso bloccato", 403);
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const right = l.quiz.map((q, i) => str(answers[i], 200) === q.opts[0]);
    const n = right.filter(Boolean).length, pct = Math.round((n / l.quiz.length) * 100), passed = pct >= 70;
    let g = await getGym(kv, me.id), gained = 0, progress;
    g.quiz = g.quiz || {};
    g.quiz[id] = Math.max(g.quiz[id] || 0, pct);
    if (passed) {
      let r = await award(kv, me, XP.quiz + (pct === 100 ? XP.quizPerfect : 0), `quiz:${id}`, g); g = r.g; gained += r.gained;
      r = await award(kv, me, XP.lesson, `les:${id}`, g); g = r.g; gained += r.gained;
      const p = await getJSON(kv, `app:progress:${me.id}`, {});
      if (!p[id]) { p[id] = now(); await putJSON(kv, `app:progress:${me.id}`, p); }
      progress = p;
    } else await putJSON(kv, `app:xp:${me.id}`, g);
    return json({ right, pct, passed, gained, gym: gymOut(g), progress, solutions: passed ? l.quiz.map((q) => q.opts[0]) : null });
  }

  if (path === "/cert" && method === "POST") {
    const content = await getContent(kv);
    const m = content.modules.find((x) => x.id === str(body.courseId, 40));
    if (!m || !m.lessons.length) return fail("Corso non trovato", 404);
    const p = await getJSON(kv, `app:progress:${me.id}`, {});
    const missing = m.lessons.filter((l) => !p[l.id]).length;
    if (missing) return fail(`Ti mancano ${missing} ${missing === 1 ? "lezione" : "lezioni"} per il certificato`);
    me.certs = me.certs || {};
    let code = me.certs[m.id];
    if (!code) {
      code = `VU-${rid(3).toUpperCase()}-${rid(2).toUpperCase()}`;
      const a = content.academies.find((x) => x.id === m.academyId), e = content.educators.find((x) => x.id === m.educatorId);
      await putJSON(kv, `app:cert:${code}`, { code, name: `${me.name} ${me.surname}`.trim(), course: m.title, academy: a ? a.name : "", educator: e ? e.name : "", lessons: m.lessons.length, at: now() });
      me.certs[m.id] = code;
      await saveUser(kv, me);
      await pushNotif(kv, me.id, { title: "Certificato ottenuto", text: m.title, link: `#/corso/${m.id}`, icon: "check" });
    }
    return json({ cert: await getJSON(kv, `app:cert:${code}`), user: publicUser(me) });
  }

  if (path === "/results" && method === "POST") {
    const date = str(body.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Data non valida");
    const age = (Date.parse(`${dayKey()}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86400000;
    if (isNaN(age) || age < 0 || age > 60) return fail("Puoi segnare solo gli ultimi 60 giorni");
    const n = (v) => Math.max(0, Math.min(999, Math.round(Number(v) || 0)));
    const res = await getJSON(kv, `app:res:${me.id}`, {});
    const row = { c: n(body.c), a: n(body.a), m: n(body.m), s: n(body.s) };
    if (row.c + row.a + row.m + row.s === 0) delete res[date]; else res[date] = row;
    const keep = Object.keys(res).sort().slice(-400);
    const out = Object.fromEntries(keep.map((k) => [k, res[k]]));
    await putJSON(kv, `app:res:${me.id}`, out);
    const r = age <= 1 && res[date] ? await award(kv, me, XP.results, `res:${date}`) : { g: await getGym(kv, me.id), gained: 0 };
    return json({ results: out, gained: r.gained, gym: gymOut(r.g) });
  }

  if (path === "/wins" && method === "GET") {
    const page = await kv.list({ prefix: "app:win:", limit: 30 });
    const wins = (await Promise.all(page.keys.map((k) => getJSON(kv, k.name)))).filter(Boolean);
    return json({ wins: wins.map((w) => winOut(w, me)) });
  }

  if (path === "/wins" && method === "POST") {
    const text = str(body.text, 280);
    const kind = WIN_KINDS.includes(body.kind) ? body.kind : "altro";
    if (text.length < 3) return fail("Racconta in una riga cosa hai ottenuto");
    const rl = `app:winrl:${me.id}:${dayKey()}`, count = Number(await kv.get(rl)) || 0;
    if (count >= 3) return fail("Hai già condiviso 3 successi oggi");
    await kv.put(rl, String(count + 1), { expirationTtl: 2 * 86400 });
    const key = `app:win:${invTs()}_${rid(4)}`;
    const w = { key, uid: me.id, author: `${me.name} ${me.surname}`.trim(), avatar: me.avatar || "", city: me.city || "", kind, text, at: now(), claps: [] };
    await putJSON(kv, key, w);
    const r = await award(kv, me, XP.win, `win:${dayKey()}`);
    return json({ win: winOut(w, me), gained: r.gained, gym: gymOut(r.g) });
  }

  const wm = path.match(/^\/wins\/(app:win:[0-9]{13}_[a-f0-9]{8})\/(clap|delete)$/);
  if (wm && method === "POST") {
    const w = await getJSON(kv, wm[1]);
    if (!w) return fail("Successo non trovato", 404);
    if (wm[2] === "delete") {
      if (w.uid !== me.id && !isAdmin) return fail("Non puoi eliminarlo", 403);
      await kv.delete(wm[1]);
      return json({ ok: true });
    }
    const had = w.claps.includes(me.id);
    w.claps = w.claps.filter((x) => x !== me.id);
    if (!had) w.claps.push(me.id);
    await putJSON(kv, wm[1], w);
    if (!had && w.uid !== me.id && w.claps.length === 1) await pushNotif(kv, w.uid, { title: `${me.name} applaude il tuo successo`, text: w.text, link: "#/allenati/successi", icon: "spark" });
    return json({ win: winOut(w, me) });
  }

  if (path === "/sim/turn" && method === "POST") {
    if (!env.ANTHROPIC_API_KEY) return fail("Il simulatore non è ancora attivo.", 503);
    const s = SIM_SCENARIOS.find((x) => x.id === body.scenario);
    if (!s) return fail("Scenario non trovato", 404);
    const history = simHistory(body.history);
    if (!history.length || history[history.length - 1].role !== "user") return fail("Di' qualcosa al cliente");
    if (history.length > SIM_MAX_TURNS * 2) return fail("La telefonata è troppo lunga: chiudila e guarda la valutazione");
    const q = await simQuota(kv, me, "turn");
    if (q) return fail(q, 429);
    try {
      let text = await callClaude(env, simSystem(s), history, { max_tokens: 3000, output_config: { effort: "low" } });
      const goal = text.includes("[OBIETTIVO]"), hangup = text.includes("[RIATTACCA]");
      text = text.replace(/\[(OBIETTIVO|RIATTACCA)\]/g, "").trim();
      return json({ text, goal, hangup });
    } catch (e) {
      return fail(e.message === "refusal" ? "Il cliente non può rispondere a questa frase. Prova a dirla in un altro modo." : "Il cliente non ha sentito: linea disturbata, riprova.", 502);
    }
  }

  if (path === "/sim/score" && method === "POST") {
    if (!env.ANTHROPIC_API_KEY) return fail("Il simulatore non è ancora attivo.", 503);
    const s = SIM_SCENARIOS.find((x) => x.id === body.scenario);
    if (!s) return fail("Scenario non trovato", 404);
    const history = simHistory(body.history);
    if (history.filter((m) => m.role === "user").length < 2) return fail("Telefonata troppo corta per una valutazione: dì almeno due frasi");
    const q = await simQuota(kv, me, "score");
    if (q) return fail(q, 429);
    const transcript = [`CLIENTE: ${s.opener}`, ...history.map((m) => `${m.role === "user" ? "PROFESSIONISTA" : "CLIENTE"}: ${m.content}`)].join("\n");
    let score;
    try {
      const raw = await callClaude(env, scoreSystem(s), [{ role: "user", content: `Ecco la telefonata da valutare:\n\n${transcript}` }], { max_tokens: 8000, output_config: { effort: "medium", format: { type: "json_schema", schema: SCORE_SCHEMA } } });
      score = JSON.parse(raw);
    } catch {
      return fail("La valutazione non è arrivata. Riprova tra poco.", 502);
    }
    score.voto = Math.max(0, Math.min(100, Math.round(Number(score.voto) || 0)));
    const pts = 10 + Math.round(score.voto / 5) + (score.obiettivo ? 10 : 0);
    const g = await getGym(kv, me.id);
    g.sims = [...(g.sims || []), { id: s.id, voto: score.voto, ok: !!score.obiettivo, at: now() }].slice(-60);
    const r = await award(kv, me, pts, null, g);
    return json({ score, gained: r.gained, gym: gymOut(r.g) });
  }

  return null;
}
