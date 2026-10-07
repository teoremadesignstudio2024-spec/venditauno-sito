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

const CATALOG_V = 5;

function catalogAcademies() {
  return [
    { id: "agenti", name: "Agenti immobiliari", icon: "handshake", color: "#2f6bff", cover: "", subs: [
      { id: "acq", name: "Acquisizione", icon: "key" },
      { id: "tra", name: "Trattativa", icon: "handshake" },
      { id: "chiu", name: "Chiusura", icon: "doc" },
      { id: "chi", name: "Chiamate a freddo", icon: "phone" },
    ] },
    { id: "inv", name: "Investimenti immobiliari", icon: "trend", color: "#eab308", cover: "", subs: [
      { id: "affari", name: "Trovare gli affari", icon: "search" },
      { id: "numeri", name: "Numeri e analisi", icon: "euro" },
      { id: "ristr", name: "Ristrutturazione e materiali", icon: "tool" },
      { id: "aste", name: "Aste", icon: "doc" },
      { id: "affitti", name: "Affitti e rendita", icon: "home2" },
    ] },
    { id: "pm", name: "Property manager", icon: "key", color: "#22c55e", cover: "", subs: [
      { id: "diventare", name: "Diventare property manager", icon: "cap" },
      { id: "piattaforme", name: "Airbnb e Booking", icon: "home2" },
      { id: "gestione", name: "Ospiti, pulizie e check-in", icon: "users" },
      { id: "prezzi", name: "Prezzi e guadagni", icon: "trend" },
      { id: "regole", name: "Regole e fisco", icon: "doc" },
    ] },
    { id: "mkt", name: "Marketing immobiliare", icon: "mega", color: "#ef4444", cover: "", subs: [
      { id: "social", name: "Social media", icon: "mega" },
      { id: "foto", name: "Foto e video", icon: "camera" },
      { id: "ai", name: "AI per agenti", icon: "spark" },
    ] },
    { id: "fin", name: "Mutui e finanza", icon: "euro", color: "#7c5cff", cover: "", subs: [
      { id: "mutui", name: "Mutui per i clienti", icon: "euro" },
      { id: "capitali", name: "Finanziare le operazioni", icon: "trend" },
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
    { id: "m1", title: "Introduzione al metodo", desc: "Come funziona Vendita Uno e come usare l'accademia.", academyId: "agenti", subId: "acq", educatorId: "sd", level: "base", cover: "", lessons: [{ id: "m1v1", title: "Introduzione al metodo Vendita Uno", youtubeId: yt, minutes: 6, desc: "", pdf: "" }] },
    { id: "m2", title: "Acquisizione mandati", desc: "Dal primo contatto all'incarico in esclusiva.", academyId: "agenti", subId: "acq", educatorId: "sd", level: "premium", cover: "", lessons: [{ id: "m2v1", title: "Come acquisire mandati in esclusiva", youtubeId: yt, minutes: 18, desc: "", pdf: "" }] },
    C("ag-tra1", "agenti", "tra", "premium", "Trattativa senza sconti", "Difendere il prezzo e la provvigione portando le parti all'accordo.", [
      ["Preparare la trattativa", "Cosa sapere di venditore e acquirente prima di sederti al tavolo."],
      ["Le obiezioni sul prezzo", "Come rispondere a \"è troppo\" senza abbassare subito."],
      ["Portare le parti all'accordo", "Proposta, controproposta e quando fermarsi."],
    ]),
    { id: "m3", title: "Chiusura e firma", desc: "Portare il cliente alla firma senza pressioni.", academyId: "agenti", subId: "chiu", educatorId: "md", level: "premium", cover: "", lessons: [{ id: "m3v1", title: "Chiusura e firma del mandato", youtubeId: yt, minutes: 15, desc: "", pdf: "" }] },
    C("ag-chi1", "agenti", "chi", "base", "Chiamate a freddo che funzionano", "Lo script, il tono e i numeri per trasformare le chiamate in appuntamenti.", [
      ["I primi 30 secondi", "Come presentarti senza farti attaccare il telefono."],
      ["Chiamare i privati che vendono da soli", "La telefonata completa, frase per frase."],
      ["Gestire il \"non mi interessa\"", "Le risposte che riaprono la conversazione."],
      ["Quante chiamate fare ogni giorno", "I numeri che servono per arrivare ai tuoi incarichi."],
    ]),
    // Investimenti immobiliari
    C("inv1", "inv", "affari", "base", "Le case che profumano di soldi", "Come riconoscere e trovare gli immobili che nascondono un guadagno, prima degli altri.", [
      ["Cosa rende un immobile un affare", "Prezzo, zona, stato e motivazione del venditore: i quattro segnali da guardare sempre."],
      ["Dove cercarle", "Aste, successioni, immobili da ristrutturare, privati che devono vendere in fretta: dove nascono le occasioni."],
      ["Leggere un annuncio come un investitore", "Cosa dicono davvero foto, descrizione e tempo online di un annuncio."],
      ["Il primo sopralluogo: la checklist", "Impianti, strutture, documenti e difetti nascosti da controllare prima di fare un'offerta."],
      ["Fare l'offerta giusta", "Come arrivare al prezzo che ti lascia margine, senza far saltare la trattativa."],
    ]),
    C("inv2", "inv", "numeri", "premium", "Calcolare se l'operazione conviene", "I numeri da fare prima di comprare: costi, tasse, valore finale e margine.", [
      ["Prezzo, costi e tasse di acquisto", "Notaio, imposte, agenzia, mutuo: tutto quello che si aggiunge al prezzo."],
      ["Stimare il valore dopo i lavori", "Come usare le vendite vicine per capire quanto varrà l'immobile finito."],
      ["Margine e rendimento: il foglio di calcolo", "Il modello da compilare per ogni operazione, passo per passo."],
      ["Gli errori che mangiano il guadagno", "Tempi lunghi, lavori sottostimati, imprevisti: come proteggersi."],
    ]),
    C("inv3", "inv", "ristr", "premium", "Ristrutturare: materiali e fornitori", "Dove comprare i materiali, come scegliere le imprese e tenere sotto controllo costi e tempi.", [
      ["Dove comprare i materiali e a che prezzo", "Grossisti, outlet, fornitori diretti: come spendere meno senza perdere qualità."],
      ["Scegliere imprese e artigiani", "Le domande da fare, i lavori da controllare e i segnali di allarme."],
      ["Capitolato e preventivi", "Come scrivere cosa vuoi e confrontare i preventivi alla pari."],
      ["Tempi di cantiere e controllo dei costi", "Pianificare i lavori e tenere il budget giorno per giorno."],
      ["Home staging per vendere prima", "Pochi interventi e allestimento per vendere più in fretta e a un prezzo migliore."],
    ]),
    C("inv4", "inv", "aste", "premium", "Aste immobiliari da zero", "Come funzionano le aste, come leggere la perizia e come partecipare senza rischi.", [
      ["Come funziona un'asta", "Tribunale, delegato, offerta minima e rilanci spiegati semplici."],
      ["Leggere la perizia", "Abusi, occupanti, spese condominiali: cosa cercare prima di partecipare."],
      ["Partecipare e aggiudicarsi l'immobile", "Cauzione, offerta, saldo prezzo e liberazione dell'immobile."],
    ]),
    C("inv5", "inv", "affitti", "premium", "Affitti e rendita", "Mettere a reddito un immobile: quale affitto scegliere e quanto rende davvero.", [
      ["Affitto lungo, breve o a studenti", "Pro e contro di ogni formula, con i numeri."],
      ["Calcolare il rendimento netto", "Dall'affitto lordo a quello che ti resta davvero in tasca."],
      ["Contratti e tutele per il proprietario", "Garanzie, cauzioni e come scegliere l'inquilino."],
    ]),
    // Property manager
    C("pm1", "pm", "diventare", "base", "Diventare property manager: il corso completo", "Dal primo proprietario all'attività avviata: tutto quello che serve per partire.", [
      ["Cos'è un property manager e quanto guadagna", "Il lavoro, i servizi che offri e come vieni pagato."],
      ["Trovare i primi proprietari", "Dove cercarli e cosa proporre per convincerli ad affidarti la casa."],
      ["Il contratto di gestione e la percentuale", "Cosa scrivere, quanto chiedere e cosa è a carico di chi."],
      ["Aprire l'attività", "Le scelte da fare all'inizio per lavorare in regola."],
    ]),
    C("pm2", "pm", "piattaforme", "premium", "Airbnb e Booking: annunci che si prenotano", "Creare e gestire annunci che riempiono il calendario.", [
      ["Creare l'annuncio", "Titolo, descrizione e servizi che fanno la differenza."],
      ["Foto e recensioni", "Le foto che fanno cliccare e come arrivare a 5 stelle."],
      ["Calendario e regole della casa", "Soggiorno minimo, orari e regole che evitano problemi."],
    ]),
    C("pm3", "pm", "gestione", "premium", "Ospiti, pulizie e check-in", "L'organizzazione di tutti i giorni, senza correre da una casa all'altra.", [
      ["Check-in autonomo e serrature smart", "Far entrare gli ospiti senza essere presente."],
      ["Pulizie e biancheria", "Trovare, organizzare e controllare chi pulisce."],
      ["Problemi e reclami", "Cosa fare quando qualcosa va storto, prima che arrivi la recensione."],
    ]),
    C("pm4", "pm", "prezzi", "premium", "Prezzi e guadagni", "Fare rendere ogni casa il più possibile.", [
      ["Prezzi dinamici", "Alzare e abbassare i prezzi in base a stagione ed eventi."],
      ["Calcolare il guadagno per ogni casa", "Incassi, costi e quanto resta a te e al proprietario."],
      ["Il report al proprietario", "Cosa mandare ogni mese per tenerlo contento."],
    ]),
    C("pm5", "pm", "regole", "premium", "Regole e fisco degli affitti brevi", "Le regole da rispettare per lavorare tranquillo.", [
      ["Codice CIN, comunicazioni e tassa di soggiorno", "Gli obblighi per ogni casa in affitto breve."],
      ["Tasse sugli affitti brevi", "Cedolare secca, fatture e cosa cambia se lo fai come attività."],
      ["Assicurazioni e tutele", "Come proteggere te, il proprietario e la casa."],
    ]),
    // Marketing immobiliare
    C("mk1", "mkt", "social", "base", "Instagram e TikTok per agenti", "Farti conoscere nella tua zona e far arrivare i clienti da soli.", [
      ["Il profilo che porta clienti", "Foto, bio e contenuti in evidenza."],
      ["Cosa pubblicare ogni settimana", "Tre formati che funzionano, con esempi veri."],
      ["Dai commenti all'appuntamento", "Come trasformare chi ti segue in clienti."],
    ]),
    C("mk2", "mkt", "foto", "premium", "Foto e video degli immobili con il telefono", "Immobili che si fanno notare, senza attrezzatura costosa.", [
      ["Foto che vendono", "Luce, angolazioni e preparazione della casa."],
      ["Il video tour in 20 minuti", "Riprendere e montare un video con il telefono."],
      ["Pubblicare sui portali e sui social", "Formati e trucchi per ogni piattaforma."],
    ]),
    C("mk3", "mkt", "ai", "base", "AI per agenti immobiliari", "Usare l'intelligenza artificiale per risparmiare ore ogni settimana.", [
      ["Scrivere annunci con l'AI", "Descrizioni migliori in due minuti."],
      ["Rispondere ai clienti più in fretta", "Messaggi, email e follow-up pronti."],
      ["Contenuti social in 10 minuti", "Idee, testi e video per tutta la settimana."],
    ]),
    // Mutui e finanza
    C("fin1", "fin", "mutui", "base", "Mutui spiegati ai tuoi clienti", "Aiutare chi compra a ottenere il mutuo e chiudere prima.", [
      ["Come funziona un mutuo", "Tasso, durata, rata e anticipo spiegati semplici."],
      ["Pre-delibera e tempi", "Cosa serve e quanto ci vuole, per non far saltare la vendita."],
      ["Lavorare con un mediatore creditizio", "Quando conviene e come collaborare."],
    ]),
    C("fin2", "fin", "capitali", "premium", "Finanziare le operazioni immobiliari", "Dove trovare i soldi per le tue operazioni.", [
      ["Capitale proprio e leva", "Quanto mettere tu e quanto farti prestare."],
      ["Soci e investitori", "Come presentare un'operazione e dividere i guadagni."],
      ["Prestiti e alternative", "Le strade possibili e i rischi di ognuna."],
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
const defaultSettings = () => ({ welcomeTitle: "Benvenuto!", welcomeSub: "Scopri Vendita Uno", onboardingTitle: "Inizia da qui", onboardingText: "Scopri come usare l'app e tutto quello che offre", onboardingVideo: "jqOjebgNQvk" });

// Vecchie accademie (versioni 1 e 2) → nuova accademia e sottocategoria.
const OLD_ACADEMIES = { acq: ["agenti", "acq"], tra: ["agenti", "tra"], chi: ["agenti", "chi"], soc: ["mkt", "social"], min: ["agenti", ""], fin: ["fin", "mutui"], leg: ["agenti", ""], ai: ["mkt", "ai"], inv: ["inv", ""] };

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
  c.settings = { ...defaultSettings(), ...(c.settings || {}) };
  if ((c.seedV || 1) < 3) migrateContent(c);
  if ((c.seedV || 1) < 5) {
    // Tolta la foto dal banner delle live: torna il banner con le sole scritte.
    const b2 = c.banners.find((b) => b.id === "b2");
    if (b2 && (b2.cover || "").startsWith("/app/banners/live")) Object.assign(b2, defaultBanners().find((b) => b.id === "b2"));
  }
  if ((c.seedV || 1) < CATALOG_V) {
    c.seedV = CATALOG_V;
    await putJSON(kv, "app:content", c);
  }
  return c;
}

// ---------- validazione contenuti admin ----------

const SECTIONS = {
  academies: (a) => ({ id: str(a.id, 40) || rid(4), name: str(a.name, 60), icon: str(a.icon, 20) || "cap", color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#2f6bff", cover: str(a.cover, 300), hero: str(a.hero, 300),
    subs: (Array.isArray(a.subs) ? a.subs : []).slice(0, 40).map((x) => ({ id: str(x.id, 40) || rid(4), name: str(x.name, 60), icon: str(x.icon, 20) || "cap" })).filter((x) => x.name) }),
  banners: (b) => ({ id: str(b.id, 40) || rid(4), title: str(b.title, 80), text: str(b.text, 200), cover: str(b.cover, 300), link: str(b.link, 300) }),
  educators: (e) => ({ id: str(e.id, 40) || rid(4), name: str(e.name, 80), academyId: str(e.academyId, 40), role: str(e.role, 80), bio: str(e.bio, 600), photo: str(e.photo, 300), email: str(e.email, 120).toLowerCase() }),
  modules: (m) => ({
    id: str(m.id, 40) || rid(4), title: str(m.title, 120), desc: str(m.desc, 400),
    academyId: str(m.academyId, 40), subId: str(m.subId, 40), educatorId: str(m.educatorId, 40), level: m.level === "premium" ? "premium" : "base", cover: str(m.cover, 300),
    lessons: (Array.isArray(m.lessons) ? m.lessons : []).slice(0, 100).map((l) => ({
      id: str(l.id, 40) || rid(4), title: str(l.title, 140), youtubeId: str(l.youtubeId, 20), minutes: Math.max(0, Math.min(600, Number(l.minutes) || 0)), desc: str(l.desc, 1000), pdf: str(l.pdf, 300),
    })),
  }),
  lives: (l) => ({
    id: str(l.id, 40) || rid(4), educatorId: str(l.educatorId, 40), title: str(l.title, 140), desc: str(l.desc, 600),
    start: isNaN(Date.parse(l.start)) ? new Date().toISOString() : new Date(l.start).toISOString(),
    minutes: Math.max(5, Math.min(600, Number(l.minutes) || 60)), url: str(l.url, 300), replayUrl: str(l.replayUrl, 300),
  }),
};

// ---------- handler ----------

export async function handleAppApi(request, env) {
  const kv = env.ACADEMY_PROGRESS;
  if (!kv) return fail("Archivio dati non configurato", 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/app/, "") || "/";
  const method = request.method;

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

  if (path === "/register" && method === "POST") return register(body, kv, env);
  if (path === "/login" && method === "POST") return login(body, kv, env);
  if (path === "/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });

  // Da qui in poi serve essere loggati
  const uid = await readToken(request, env);
  const me = uid ? await getJSON(kv, `app:user:${uid}`) : null;
  if (!me) return fail("Non autenticato", 401);
  const isAdmin = me.role === "admin";

  if (path === "/me" && method === "GET") {
    const [content, progress, reminders] = await Promise.all([
      getContent(kv), getJSON(kv, `app:progress:${me.id}`, {}), getJSON(kv, `app:rem:${me.id}`, []),
    ]);
    return json({ user: publicUser(me), content, progress, reminders });
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
    if (me.avatar) await kv.delete(`app:img:${me.avatar}`);
    me.avatar = id;
    await saveUser(kv, me);
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

  if (path === "/progress" && method === "POST") {
    const p = await getJSON(kv, `app:progress:${me.id}`, {});
    const id = str(body.lessonId, 40);
    if (body.done) p[id] = now(); else delete p[id];
    await putJSON(kv, `app:progress:${me.id}`, p);
    return json({ progress: p });
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

  // ----- rete e guadagni -----
  if (path === "/network" && method === "GET") {
    const users = await listAll(kv, "app:user:", 5000);
    const lvl1 = users.filter((k) => k.metadata && k.metadata.ref === me.id);
    const ids1 = new Set(lvl1.map((k) => k.name.slice(9)));
    const lvl2 = users.filter((k) => k.metadata && ids1.has(k.metadata.ref));
    const out = (k) => ({ id: k.name.slice(9), name: k.metadata.n, city: k.metadata.c, at: k.metadata.t, avatar: k.metadata.a });
    return json({ refCode: me.refCode, level1: lvl1.map(out), level2: lvl2.map(out), earnings: await getJSON(kv, `app:earn:${me.id}`, { total: 0, available: 0, pending: 0, items: [] }) });
  }

  if (path === "/zone" && method === "POST") {
    const comune = str(body.comune, 80), phone = str(body.phone, 30);
    if (!comune || phone.replace(/\D/g, "").length < 6) return fail("Inserisci comune e telefono");
    const key = `app:zone:${invTs()}_${rid(4)}`;
    await putJSON(kv, key, { key, uid: me.id, name: `${me.name} ${me.surname}`.trim(), email: me.email, comune, phone, note: str(body.note, 500), at: now() });
    return json({ ok: true });
  }

  // ----- admin -----
  if (path.startsWith("/admin/")) {
    if (!isAdmin) return fail("Solo per amministratori", 403);

    if (path === "/admin/users" && method === "GET") {
      const users = await listAll(kv, "app:user:", 5000);
      const byId = Object.fromEntries(users.map((k) => [k.name.slice(9), k.metadata || {}]));
      return json({ users: users.map((k) => ({ id: k.name.slice(9), name: k.metadata.n, email: k.metadata.e, role: k.metadata.r, city: k.metadata.c, at: k.metadata.t, referredBy: k.metadata.ref ? (byId[k.metadata.ref] || {}).n || "" : "" })).sort((a, b) => b.at - a.at) });
    }

    if (path === "/admin/role" && method === "POST") {
      const u = await getJSON(kv, `app:user:${str(body.id, 40)}`);
      if (!u) return fail("Utente non trovato", 404);
      if (!["agent", "educator", "admin"].includes(body.role)) return fail("Ruolo non valido");
      if (u.id === me.id && body.role !== "admin") return fail("Non puoi togliere l'accesso admin a te stesso");
      u.role = body.role;
      await saveUser(kv, u);
      return json({ ok: true });
    }

    if (path === "/admin/content" && method === "POST") {
      const section = str(body.section, 20);
      if (!SECTIONS[section] || !Array.isArray(body.data)) return fail("Sezione non valida");
      const content = await getContent(kv);
      content[section] = body.data.slice(0, 500).map(SECTIONS[section]);
      if (section === "lives") content.lives.sort((a, b) => a.start.localeCompare(b.start));
      await putJSON(kv, "app:content", content);
      return json({ content });
    }

    if (path === "/admin/settings" && method === "POST") {
      const content = await getContent(kv);
      for (const k of Object.keys(defaultSettings())) if (k in body) content.settings[k] = str(body[k], 300);
      await putJSON(kv, "app:content", content);
      return json({ content });
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

function postOut(p, me) {
  return { key: p.key, author: p.author, avatar: p.avatar, role: p.role, educatorId: p.educatorId, city: p.city, text: p.text, image: p.image || "", at: p.at, likes: p.likes.length, liked: p.likes.includes(me.id), comments: p.comments, mine: p.uid === me.id };
}

async function storeImage(kv, dataUrl, maxBytes = MAX_IMG_BYTES) {
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const bin = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  if (bin.length > maxBytes || bin[0] !== 0xff || bin[1] !== 0xd8) return null;
  const id = rid(12);
  await kv.put(`app:img:${id}`, bin);
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
    refCode, referredBy, following: [], avatar: "", createdAt: now(),
    pass: { salt, iter: PBKDF2_ITER, hash: await hashPassword(password, salt) },
  };
  await saveUser(kv, user);
  await kv.put(`app:email:${email}`, user.id);
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
