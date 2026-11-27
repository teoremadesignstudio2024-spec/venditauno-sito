// API della Vendita Uno Academy (/academy). Dati nel KV ACADEMY_PROGRESS con prefisso "ac:".
//
//   ac:user:<username>   account (cliente o admin) con password cifrata e corsi visibili
//   ac:content           corsi → moduli → lezioni, e impostazioni (colore)
//   ac:prog:<username>   lezioni completate { lessonId: timestamp } e ultima lezione aperta
//   ac:img:<id>          copertine e miniature caricate dall'admin
//   ac:rl:<chiave>       tentativi di accesso sbagliati (blocco temporaneo)
//
// Non ci si iscrive da soli: i clienti li crea l'admin. Il primo admin si crea una volta sola
// con il codice di attivazione (qui c'è solo la sua impronta).

const COOKIE = "vu_academy";
const SESSION_DAYS = 60;
const FALLBACK_SECRET = "vendita-uno-academy-secret-cambiami";
const PBKDF2_ITER = 100000;
const SETUP_HASH = "e4d73f002659d7d2b3c49de49769098116e2bf35e6beddb154044738b568d53d";
const CONTENT_V = 3;
const ACCENT = "#ff1a4f"; // cremisi elettrico

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rid = (n = 6) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Date.now();
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store", ...headers } });
}
const fail = (msg, status = 400) => json({ error: msg }, status);
const getJSON = async (kv, key, fallback = null) => { const raw = await kv.get(key); return raw ? JSON.parse(raw) : fallback; };
const putJSON = (kv, key, value, opts) => kv.put(key, JSON.stringify(value), opts);

// ---------- password e sessioni ----------
async function hashPassword(password, salt, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: iter, hash: "SHA-256" }, key, 256));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const secretOf = (env) => env.ACADEMY_SECRET || env.APP_SECRET || FALLBACK_SECRET;
async function hmac(message, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}
// La sessione porta anche la "versione" della password: cambiandola, le vecchie sessioni smettono di valere.
async function makeToken(u, env) {
  const exp = now() + SESSION_DAYS * 86400000;
  // Il punto separa le parti del token: nello username va codificato (mario.rossi → mario%2Erossi).
  const body = `${encodeURIComponent(u.username).replace(/\./g, "%2E")}.${u.pv || 0}.${exp}`;
  return `${body}.${await hmac(body, secretOf(env))}`;
}
async function readToken(request, env) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 4) return null;
  const [user, pv, exp, sig] = parts;
  if (now() > Number(exp)) return null;
  if (!safeEqual(sig, await hmac(`${user}.${pv}.${exp}`, secretOf(env)))) return null;
  return { username: decodeURIComponent(user), pv: Number(pv) };
}
const cookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
async function setPassword(u, password) {
  const salt = rid(16);
  u.pass = { salt, iter: PBKDF2_ITER, hash: await hashPassword(password, salt) };
  u.pv = (u.pv || 0) + 1;
}
// Username: minuscolo, senza spazi né accenti. Va bene anche un'email (mario@agenzia.it).
const cleanUsername = (v) => str(v, 80).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
const validUsername = (u) => /^[a-z0-9._@+-]{3,80}$/.test(u);
const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, access: u.access, blocked: !!u.blocked, createdAt: u.createdAt, lastLogin: u.lastLogin || 0 });

// ---------- contenuti ----------
const loom = (id) => `https://www.loom.com/share/${id}`;
function seedContent() {
  const C = (n, id, title, desc, lessons = []) => ({ id, n, title, desc, cover: "", modules: [{ id: `${id}-m1`, title: "Lezioni", lessons: lessons.map(([t, v], i) => ({ id: `${id}-l${i + 1}`, title: t, video: v, desc: "", pdf: "", thumb: "" })) }] });
  return {
    v: CONTENT_V,
    settings: { accent: ACCENT, heroTitle: "La tua libreria corsi", heroText: "Qui trovi i pilastri della formazione per costruire un'agenzia immobiliare che vende: dal piano alla squadra, passo dopo passo." },
    courses: [
      C(1, "business-planning", "Business Planning", "Il piano della tua agenzia: dove vuoi arrivare, con quali numeri e in quanto tempo. Dall'idea a un'attività che cresce e batte la concorrenza."),
      C(2, "marketing", "Marketing", "Fare marketing non è magia: è un sistema per farti trovare, attirare proprietari e trasformarli in incarichi."),
      C(3, "vendita", "Vendita", "Le trattative non si improvvisano. Il metodo per acquisire, trattare e chiudere senza svendere il tuo lavoro."),
      C(4, "branding", "Branding", "Perché un proprietario dovrebbe scegliere te e non l'agenzia accanto? Costruisci un'identità che si riconosce e si ricorda."),
      C(5, "finance", "Finance", "Margini, costi, provvigioni e cassa: i numeri che decidono se la tua agenzia guadagna davvero."),
      C(6, "organizzazione", "Organizzazione", "Procedure, strumenti e agenda per un'agenzia che gira senza che tu debba rincorrere tutto."),
      C(7, "mindset", "Mindset", "Fare impresa è stressante come poche altre cose. Le abitudini e il modo di pensare per reggere e crescere."),
      C(8, "leadership", "Leadership", "Un'agenzia è forte quanto il suo agente più debole. Come guidare, formare e motivare una squadra che vende."),
      C(9, "videomaking", "Videomaking", "Video per immobili e per i social fatti col telefono: riprese, montaggio e contenuti che portano clienti."),
    ],
  };
}
async function getContent(kv) {
  let c = await getJSON(kv, "ac:content");
  if (!c) { c = seedContent(); await putJSON(kv, "ac:content", c); }
  c.settings = { ...seedContent().settings, ...(c.settings || {}) };
  if ((c.v || 1) < 2) {
    // Il primo bordeaux era troppo spento: passa al cremisi elettrico (solo se non era stato cambiato).
    if (c.settings.accent === "#9b1c31") c.settings.accent = ACCENT;
    c.v = 2;
    await putJSON(kv, "ac:content", c);
  }
  if (c.v < 3) {
    // Tolte tutte le lezioni (i corsi restano): le nuove arrivano dalla cartella dei video.
    for (const co of c.courses) co.modules = [{ id: `${co.id}-m1`, title: "Lezioni", lessons: [] }];
    c.v = 3;
    await putJSON(kv, "ac:content", c);
  }
  return c;
}
const isColor = (v) => /^#[0-9a-f]{6}$/i.test(v || "");
function cleanCourse(c, i) {
  return {
    id: str(c.id, 40) || rid(4), n: i + 1, title: str(c.title, 120) || "Nuovo corso", desc: str(c.desc, 800), cover: str(c.cover, 300),
    modules: (Array.isArray(c.modules) ? c.modules : []).slice(0, 40).map((m) => ({
      id: str(m.id, 40) || rid(4), title: str(m.title, 120) || "Modulo",
      lessons: (Array.isArray(m.lessons) ? m.lessons : []).slice(0, 200).map((l) => ({
        id: str(l.id, 40) || rid(4), title: str(l.title, 160) || "Lezione", video: str(l.video, 400), desc: str(l.desc, 3000), pdf: str(l.pdf, 400), thumb: str(l.thumb, 300),
      })),
    })),
  };
}
const canSee = (u, courseId) => u.role === "admin" || u.access === "all" || (Array.isArray(u.access) && u.access.includes(courseId));
const contentFor = (u, c) => ({ settings: c.settings, courses: c.courses.filter((x) => canSee(u, x.id)) });

// ---------- immagini ----------
async function storeImage(kv, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) return null;
  const bin = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  if (bin.length > 700 * 1024) return null;
  const id = rid(12);
  await kv.put(`ac:img:${id}`, bin, { metadata: { type: `image/${m[1]}` } });
  return id;
}

async function listUsers(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: "ac:user:", cursor });
    out.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < 5000);
  const users = [];
  for (let i = 0; i < out.length; i += 50) users.push(...(await Promise.all(out.slice(i, i + 50).map((k) => getJSON(kv, k)))));
  return users.filter(Boolean);
}

// Troppi tentativi sbagliati: blocco di 15 minuti per username e per indirizzo.
async function tooMany(kv, keys) {
  const vals = await Promise.all(keys.map((k) => kv.get(`ac:rl:${k}`)));
  return vals.some((v) => Number(v) >= 8);
}
async function addFail(kv, keys) {
  await Promise.all(keys.map(async (k) => { const v = Number(await kv.get(`ac:rl:${k}`)) || 0; await kv.put(`ac:rl:${k}`, String(v + 1), { expirationTtl: 900 }); }));
}

// =====================================================================
export async function handleAcademyApi(request, env) {
  const kv = env.ACADEMY_PROGRESS;
  if (!kv) return fail("Archivio non configurato", 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/academy/, "") || "/";
  const method = request.method;

  const img = path.match(/^\/img\/([a-f0-9]{24})$/);
  if (img && method === "GET") {
    const { value, metadata } = await kv.getWithMetadata(`ac:img:${img[1]}`, { type: "arrayBuffer" });
    if (!value) return new Response("Not found", { status: 404 });
    return new Response(value, { headers: { "Content-Type": (metadata && metadata.type) || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }

  let body = {};
  if (method === "POST") {
    if (!(request.headers.get("Content-Type") || "").includes("application/json")) return fail("Formato non valido", 415);
    try { body = await request.json(); } catch { return fail("Dati non validi"); }
  }
  const ip = request.headers.get("CF-Connecting-IP") || "x";

  // Prima attivazione: crea l'admin con il codice (una volta sola).
  if (path === "/setup" && method === "GET") return json({ needed: !(await kv.get("ac:setupDone")) });
  if (path === "/setup" && method === "POST") {
    if (await kv.get("ac:setupDone")) return fail("L'Academy è già stata attivata", 403);
    if (await tooMany(kv, [`setup:${ip}`])) return fail("Troppi tentativi. Riprova tra 15 minuti.", 429);
    const h = toHex(await crypto.subtle.digest("SHA-256", enc.encode(str(body.code, 60).toUpperCase())));
    if (!safeEqual(h, SETUP_HASH)) { await addFail(kv, [`setup:${ip}`]); return fail("Codice di attivazione non valido"); }
    const username = cleanUsername(body.username);
    if (!validUsername(username)) return fail("Username: almeno 3 caratteri, senza spazi (puoi usare anche la tua email)");
    if (str(body.password, 200).length < 8) return fail("La password deve avere almeno 8 caratteri");
    const u = { username, name: str(body.name, 80) || "Admin", role: "admin", access: "all", createdAt: now() };
    await setPassword(u, str(body.password, 200));
    await putJSON(kv, `ac:user:${username}`, u);
    await kv.put("ac:setupDone", "1");
    return json({ ok: true }, 200, { "Set-Cookie": cookie(await makeToken(u, env), SESSION_DAYS * 86400) });
  }

  if (path === "/login" && method === "POST") {
    const username = cleanUsername(body.username);
    const keys = [`u:${username}`, `ip:${ip}`];
    if (await tooMany(kv, keys)) return fail("Troppi tentativi sbagliati. Riprova tra 15 minuti.", 429);
    const u = username && (await getJSON(kv, `ac:user:${username}`));
    const ok = u && safeEqual(await hashPassword(str(body.password, 200), u.pass.salt, u.pass.iter), u.pass.hash);
    if (!ok) { await addFail(kv, keys); return fail("Username o password non corretti", 401); }
    if (u.blocked) return fail("Il tuo accesso è sospeso. Contatta Vendita Uno.", 403);
    u.lastLogin = now();
    await putJSON(kv, `ac:user:${username}`, u);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(await makeToken(u, env), SESSION_DAYS * 86400) });
  }
  if (path === "/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });

  // ---- da qui serve essere entrati ----
  const t = await readToken(request, env);
  const me = t && (await getJSON(kv, `ac:user:${t.username}`));
  if (!me || (me.pv || 0) !== t.pv) return fail("Non autenticato", 401);
  if (me.blocked) return fail("Il tuo accesso è sospeso. Contatta Vendita Uno.", 403);
  const isAdmin = me.role === "admin";

  if (path === "/me" && method === "GET") {
    const [content, prog] = await Promise.all([getContent(kv), getJSON(kv, `ac:prog:${me.username}`, { done: {}, last: "" })]);
    return json({ user: publicUser(me), content: contentFor(me, content), progress: prog });
  }

  if (path === "/progress" && method === "POST") {
    const content = await getContent(kv);
    const id = str(body.lessonId, 40);
    const course = content.courses.find((c) => c.modules.some((m) => m.lessons.some((l) => l.id === id)));
    if (!course || !canSee(me, course.id)) return fail("Lezione non trovata", 404);
    const p = await getJSON(kv, `ac:prog:${me.username}`, { done: {}, last: "" });
    if ("done" in body) { if (body.done) p.done[id] = now(); else delete p.done[id]; }
    if (body.open) p.last = id;
    await putJSON(kv, `ac:prog:${me.username}`, p);
    return json({ progress: p });
  }

  if (path === "/password" && method === "POST") {
    if (!safeEqual(await hashPassword(str(body.old, 200), me.pass.salt, me.pass.iter), me.pass.hash)) return fail("La password attuale non è corretta");
    if (str(body.password, 200).length < 8) return fail("La nuova password deve avere almeno 8 caratteri");
    await setPassword(me, str(body.password, 200));
    await putJSON(kv, `ac:user:${me.username}`, me);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(await makeToken(me, env), SESSION_DAYS * 86400) });
  }

  // ---- pannello admin ----
  if (!path.startsWith("/admin/")) return fail("Non trovato", 404);
  if (!isAdmin) return fail("Solo per amministratori", 403);

  if (path === "/admin/users" && method === "GET") {
    const [users, content] = await Promise.all([listUsers(kv), getContent(kv)]);
    const total = (u) => content.courses.filter((c) => canSee(u, c.id)).flatMap((c) => c.modules.flatMap((m) => m.lessons.map((l) => l.id)));
    const progs = await Promise.all(users.map((u) => getJSON(kv, `ac:prog:${u.username}`, { done: {} })));
    return json({ users: users.map((u, i) => { const ids = total(u); const d = ids.filter((x) => progs[i].done[x]).length; return { ...publicUser(u), done: d, lessons: ids.length }; }).sort((a, b) => b.createdAt - a.createdAt) });
  }

  if (path === "/admin/user" && method === "POST") {
    const username = cleanUsername(body.username);
    if (!validUsername(username)) return fail("Username: almeno 3 caratteri, senza spazi (puoi usare anche l'email del cliente)");
    let u = await getJSON(kv, `ac:user:${username}`);
    const isNew = !u;
    if (isNew && !body.create) return fail("Cliente non trovato", 404);
    if (!isNew && body.create) return fail("Questo username esiste già");
    if (isNew) u = { username, role: "client", createdAt: now() };
    if ("name" in body) u.name = str(body.name, 80);
    if (!u.name) return fail("Scrivi il nome del cliente");
    if ("access" in body) u.access = body.access === "all" ? "all" : (Array.isArray(body.access) ? body.access.map((x) => str(x, 40)).slice(0, 100) : []);
    if (!u.access) u.access = "all";
    if ("blocked" in body) {
      if (username === me.username && body.blocked) return fail("Non puoi bloccare te stesso");
      u.blocked = !!body.blocked;
    }
    if ("role" in body && username !== me.username) u.role = body.role === "admin" ? "admin" : "client";
    if (body.password) {
      if (str(body.password, 200).length < 8) return fail("La password deve avere almeno 8 caratteri");
      await setPassword(u, str(body.password, 200));
    }
    if (isNew && !u.pass) return fail("Scegli una password per il cliente");
    await putJSON(kv, `ac:user:${username}`, u);
    return json({ user: publicUser(u) });
  }

  if (path === "/admin/user/delete" && method === "POST") {
    const username = cleanUsername(body.username);
    if (username === me.username) return fail("Non puoi eliminare te stesso");
    await Promise.all([kv.delete(`ac:user:${username}`), kv.delete(`ac:prog:${username}`)]);
    return json({ ok: true });
  }

  if (path === "/admin/content" && method === "POST") {
    const c = await getContent(kv);
    if (Array.isArray(body.courses)) c.courses = body.courses.slice(0, 60).map(cleanCourse);
    if (body.settings) {
      const s = body.settings;
      if (isColor(s.accent)) c.settings.accent = s.accent;
      if ("heroTitle" in s) c.settings.heroTitle = str(s.heroTitle, 80);
      if ("heroText" in s) c.settings.heroText = str(s.heroText, 300);
    }
    c.v = CONTENT_V;
    await putJSON(kv, "ac:content", c);
    return json({ content: c });
  }

  if (path === "/admin/image" && method === "POST") {
    const id = await storeImage(kv, body.dataUrl);
    if (!id) return fail("Immagine non valida o troppo grande");
    return json({ url: `/api/academy/img/${id}` });
  }

  return fail("Non trovato", 404);
}
