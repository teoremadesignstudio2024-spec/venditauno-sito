"use strict";
// App Vendita Uno: accademia Agenti immobiliari, allenamento al telefono con l'AI, progressi, community e pannello admin.
// Tutte le schermate sono disegnate qui; i dati arrivano da /api/app (vedi app-api.js).

const S = { user: null, content: null, progress: {}, reminders: [], week: 0, selLive: null, postsCache: null };
const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");

// ---------- utility ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^(https:\/\/|\/(?!\/))/.test(u || "") ? u : "");
const icon = (id, cls = "") => `<svg class="i ${cls}"><use href="#i-${id}"/></svg>`;
const initials = (name) => esc((name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join(""));
const imgUrl = (id) => (id ? `/api/app/img/${id}` : "");
function face(name, photo, cls = "") {
  const u = safeUrl(photo);
  return u ? `<img class="av ${cls}" src="${esc(u)}" alt="" loading="lazy">` : `<span class="ini ${cls}">${initials(name)}</span>`;
}
const userFace = (u) => face(`${u.name} ${u.surname}`, imgUrl(u.avatar));
const fullName = (u) => `${u.name} ${u.surname}`.trim();
const DOW = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const fmtTime = (d) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (d) => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "adesso";
  if (m < 60) return `${m} min fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "ora" : "ore"} fa`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ieri";
  if (d < 7) return `${d} giorni fa`;
  return new Date(ts).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}
function ytId(s) {
  s = (s || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/live\/|\/shorts\/|\/v\/|youtube\.com\/e\/)([\w-]{11})(?![\w-])/);
  return m ? m[1] : "";
}

// Video: YouTube, Loom, Vimeo, Google Drive o file .mp4 → indirizzo da mostrare dentro l'app.
function videoSrc(url, autoplay = false) {
  const u = (url || "").trim();
  if (!u) return null;
  const y = ytId(u);
  if (y) return { kind: "YouTube", src: `https://www.youtube-nocookie.com/embed/${y}?rel=0&modestbranding=1${autoplay ? "&autoplay=1" : ""}` };
  let m = u.match(/loom\.com\/(?:share|embed)\/([a-f0-9]{32})/i);
  if (m) return { kind: "Loom", src: `https://www.loom.com/embed/${m[1]}?hideEmbedTopBar=true${autoplay ? "&autoplay=1" : ""}` };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/i);
  if (m) return { kind: "Vimeo", src: `https://player.vimeo.com/video/${m[1]}${m[2] ? "?h=" + m[2] + "&" : "?"}title=0&byline=0${autoplay ? "&autoplay=1" : ""}` };
  m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (m) return { kind: "Google Drive", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/^https:\/\/\S+\.(mp4|webm|mov)(\?|$)/i.test(u)) return { kind: "File video", src: u, file: true };
  return null;
}
function playerHtml(url, title = "", autoplay = false) {
  const v = videoSrc(url, autoplay);
  if (!v) return `<div class="player"><div class="ph">${icon("play")}Video in arrivo</div></div>`;
  if (v.file) return `<div class="player"><video src="${esc(v.src)}" controls playsinline ${autoplay ? "autoplay" : ""} style="position:absolute;inset:0;width:100%;height:100%;background:#000"></video></div>`;
  return `<div class="player"><iframe src="${esc(v.src)}" title="${esc(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
}
const lessonVideo = (l) => l.video || l.youtubeId || "";

let toastT;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), 2200);
}

async function api(path, body) {
  const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(`/api/app${path}`, { credentials: "same-origin", ...opts });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith("/login") && !path.startsWith("/register")) {
    S.user = null;
    location.hash = "#/accedi";
    throw new Error(data.error || "Accedi per continuare");
  }
  if (!res.ok) throw new Error(data.error || serverError(res.status));
  return data;
}
function serverError(status) {
  if (status === 413) return "File troppo grande per il server";
  if (status >= 500) return `Il server non ce l'ha fatta (errore ${status}). Riprova tra poco.`;
  return `Qualcosa è andato storto (errore ${status}). Riprova.`;
}
// Invia un file così com'è (video, foto o PDF) e restituisce il suo codice. onProgress riceve la percentuale.
function uploadBlob(blob, type, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/app/upload");
    x.withCredentials = true;
    x.setRequestHeader("Content-Type", type);
    if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      let data = {};
      try { data = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300 && data.id) resolve(data.id);
      else reject(new Error(data.error || serverError(x.status)));
    };
    x.onerror = () => reject(new Error("Connessione persa durante il caricamento. Riprova."));
    x.send(blob);
  });
}

// Ridimensiona una foto nel browser prima di caricarla (JPEG leggero).
function resizeImage(file, max = 360, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Immagine non valida"));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- finestra in basso ----------
function openSheet(title, html, onReady) {
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = html;
  $("#sheet").classList.add("open");
  if (onReady) onReady($("#sheetBody"));
}
function closeSheet() {
  $("#sheet").classList.remove("open");
  setTimeout(() => { if (!$("#sheet").classList.contains("open")) $("#sheetBody").innerHTML = ""; }, 250);
}
$("#sheetClose").onclick = closeSheet;
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

// ---------- dati derivati ----------
const allLessons = () => S.content.modules.flatMap((m, mi) => m.lessons.map((l) => ({ ...l, module: m, mi })));
const eduById = (id) => S.content.educators.find((e) => e.id === id);
const academyById = (id) => S.content.academies.find((a) => a.id === id);
function nextLesson() {
  const ls = allLessons();
  return ls.find((l) => !S.progress[l.id]) || ls[0];
}
const courseById = (id) => S.content.modules.find((m) => m.id === id);
const subOf = (m) => { const a = academyById(m.academyId); return a && (a.subs || []).find((x) => x.id === m.subId); };
const accColor = (a) => (a && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#2f6bff");
// Sfondo: foto caricata, altrimenti copertina generata con colore e icona dell'accademia.
function coverBg(url, color, ic) {
  const u = safeUrl(url);
  return u ? `<div class="bg" style="background-image:url('${esc(u)}')"></div>` : `<div class="bg gen" style="--c:${color}">${typeof ic === "number" ? `<b class="big-n">${ic}</b>` : icon(ic || "cap", "big-ic")}</div>`;
}
function courseStats(m) {
  const all = m.lessons.length, done = m.lessons.filter((l) => S.progress[l.id]).length;
  return { all, done, pct: all ? Math.round((done / all) * 100) : 0 };
}
// Ogni sezione dell'accademia ha il suo colore, così le copertine si distinguono.
const SUB_COLORS = ["#2f6bff", "#7c3aed", "#0f9d58", "#ea580c", "#0891b2", "#db2777", "#ca8a04"];
function courseColor(m) {
  const a = academyById(m.academyId), i = a ? (a.subs || []).findIndex((x) => x.id === m.subId) : -1;
  return i >= 0 ? SUB_COLORS[i % SUB_COLORS.length] : accColor(a);
}
// Numero della sezione a cui appartiene il corso (1-7), oppure l'icona se non ne ha una.
function subNum(m) {
  const a = academyById(m.academyId), i = a ? (a.subs || []).findIndex((x) => x.id === m.subId) : -1;
  return i >= 0 ? i + 1 : "cap";
}
function courseCard(m) {
  const a = academyById(m.academyId), e = eduById(m.educatorId), c = courseColor(m), st = courseStats(m);
  const saved = (S.user.saved || []).includes(m.id);
  return `<a class="ccard ${canCourse(m) ? "" : "locked"}" href="#/corso/${esc(m.id)}">${canCourse(m) ? "" : `<span class="lockchip">${icon("lock", "sm")}Bloccato</span>`}
    <div class="cov" style="--c:${c}">${coverBg(m.cover, c, subNum(m))}
      <div class="info">
        <h3>${esc(m.title)}</h3>
        ${e ? `<div class="by">${face(e.name, e.photo)}${esc(e.name)}</div>` : ""}
        <div class="meta">
          <span class="lvl ${m.level === "premium" ? "premium" : "base"}"><svg viewBox="0 0 24 24"><path d="M12 2l3 6.6 7 .7-5.3 4.7 1.6 7L12 17.3 5.7 21l1.6-7L2 9.3l7-.7z"/></svg>${m.level === "premium" ? "Premium" : "Base"}</span>
          <span class="acts"><button data-play="${esc(m.id)}" aria-label="${canCourse(m) ? "Inizia" : "Bloccato"}" class="${canCourse(m) ? "" : "lockb"}">${icon(canCourse(m) ? "play" : "lock")}</button><button data-save="${esc(m.id)}" class="${saved ? "saved" : ""}" aria-label="Salva">${icon(saved ? "check" : "plus")}</button></span>
        </div>
      </div>
    </div>
    <div class="ft"><span>${icon("cap", "sm")}${st.all} ${st.all === 1 ? "lezione" : "lezioni"}</span><span>${st.done ? `${st.pct}% <span class="prog"><i style="width:${st.pct}%"></i></span>` : "Da iniziare"}</span></div>
  </a>`;
}
// ---------- accessi (contenuti bloccati) ----------
const fullAccess = () => !S.user || S.user.role === "admin" || S.user.role === "educator" || !Array.isArray(S.user.access) || S.user.access.includes("all");
const can = (what) => fullAccess() || S.user.access.includes(what);
const canCourse = (m) => fullAccess() || S.user.access.includes(`course:${m.id}`) || S.user.access.includes(`acad:${m.academyId}`);
const money = (cents, cur = "eur") => ((Number(cents) || 0) / 100).toLocaleString("it-IT", { style: "currency", currency: (cur || "eur").toUpperCase() });
const NEED_LABEL = { community: "la community" };
// Un prodotto sblocca "need" se lo comprende (o comprende tutto / l'accademia del corso)
function productCovers(p, need) {
  if (!need || p.grants.includes("all") || p.grants.includes(need)) return true;
  if (need.startsWith("course:")) { const m = courseById(need.slice(7)); return !!m && p.grants.includes(`acad:${m.academyId}`); }
  return false;
}
function buyUrl(p) {
  const sep = p.link.includes("?") ? "&" : "?";
  return `${p.link}${sep}client_reference_id=${encodeURIComponent(`${S.user.id}__${p.id}`)}&prefilled_email=${encodeURIComponent(S.user.email)}`;
}
function productsHtml(list) {
  return list.map((p) => `<div class="prod"><div class="grow"><h4>${esc(p.name)}</h4>${p.desc ? `<p>${esc(p.desc)}</p>` : ""}</div><div class="pr">${p.price ? `<b>${esc(p.price)}</b>` : ""}${p.link ? `<a class="btn pri" href="${esc(buyUrl(p))}" rel="noopener">Acquista</a>` : `<span class="small muted">In arrivo</span>`}</div></div>`).join("");
}
function openUnlock(need, title) {
  const all = (S.content.products || []);
  const fit = all.filter((p) => productCovers(p, need));
  const list = fit.length ? fit : all;
  openSheet(title || "Contenuto bloccato", `
    <div class="lockhero"><span>${icon("lock")}</span><p>${need && NEED_LABEL[need] ? `Per accedere a ${NEED_LABEL[need]} sblocca uno di questi prodotti.` : "Sblocca il contenuto con uno di questi prodotti."}</p></div>
    ${list.length ? `<div class="prods">${productsHtml(list)}</div><p class="small muted" style="margin-top:10px;text-align:center">Paghi in modo sicuro con Stripe. L'accesso si attiva da solo dopo il pagamento.</p>`
      : `<div class="empty">Al momento non ci sono prodotti da acquistare.<br>Contatta l'amministratore.</div>`}`);
}
function lockedView(need, title, text) {
  view.innerHTML = `<div class="locked-page">
    <div class="ghost">${[1, 2, 3].map(() => `<div class="card pad"><div class="row"><span class="ini" style="width:38px;height:38px"></span><div class="grow"><div class="gl" style="width:60%"></div><div class="gl" style="width:35%"></div></div></div><div class="gl" style="margin-top:12px"></div><div class="gl" style="width:80%"></div></div>`).join("")}</div>
    <div class="lockbox"><span class="lk">${icon("lock")}</span><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="btn pri block" id="unlockBtn">${icon("key", "sm")}Sblocca</button></div>
  </div>`;
  $("#unlockBtn").onclick = () => openUnlock(need, title);
}

function bindCourses(root) {
  root.querySelectorAll("[data-play]").forEach((b) => (b.onclick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const m = courseById(b.dataset.play);
    if (m && !canCourse(m)) { openUnlock(`course:${m.id}`, m.title); return; }
    const l = m && (m.lessons.find((x) => !S.progress[x.id]) || m.lessons[0]);
    location.hash = l ? `#/lezione/${l.id}` : `#/corso/${b.dataset.play}`;
  }));
  root.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const id = b.dataset.save, on = !(S.user.saved || []).includes(id);
    try {
      S.user = (await api("/save", { courseId: id, on })).user;
      b.classList.toggle("saved", on);
      b.innerHTML = icon(on ? "check" : "plus");
      toast(on ? "Salvato nei tuoi corsi" : "Tolto dai tuoi corsi");
    } catch (e) { toast(e.message); }
  }));
}
function academyCard(a) {
  const c = accColor(a);
  // Card fatta su Canva con nome e icona già dentro: si mostra intera, senza scritte aggiunte.
  if (safeUrl(a.card)) return `<a class="acard full" href="#/percorso/${esc(a.id)}" style="--c:${c}">
    <img src="${esc(safeUrl(a.card))}" alt="${esc(a.name)}" loading="lazy">
    <span class="tag">${(a.subs || []).length ? `${a.subs.length} sezioni · ` : ""}${S.content.modules.filter((m) => m.academyId === a.id).length} corsi</span>
  </a>`;
  return `<a class="acard boxed" href="#/percorso/${esc(a.id)}" style="--c:${c}">
    <div class="ph">${coverBg(a.cover, c, a.icon)}<div class="ov"><span class="tile">${icon(a.icon || "cap")}</span><h4>${esc(a.name)}</h4></div></div>
    <span class="tag">${(a.subs || []).length ? `${a.subs.length} sezioni · ` : ""}${S.content.modules.filter((m) => m.academyId === a.id).length} corsi</span>
  </a>`;
}
function secHd(title, count, extra = "") {
  return `<div class="sec-hd"><h2>${esc(title)}</h2>${count != null ? `<span class="cnt">${count}</span>` : ""}<span class="ln"></span>${extra}</div>`;
}
const carouselArrows = (id) => `<span class="arr only-desk"><button data-scroll="${id}" data-d="-1" aria-label="Indietro">${icon("back")}</button><button data-scroll="${id}" data-d="1" aria-label="Avanti">${icon("chev")}</button></span>`;
function bindScroll(root) {
  root.querySelectorAll("[data-scroll]").forEach((b) => (b.onclick = () => {
    const el = document.getElementById(b.dataset.scroll);
    el.scrollBy({ left: Number(b.dataset.d) * el.clientWidth * 0.8, behavior: "smooth" });
  }));
}
// ---------- router ----------
const ROUTES = {
  accedi: { fn: viewAuth, auth: false },
  home: { fn: viewHome, title: "Home", nav: "home" },
  accademia: { fn: viewAcademy, title: "Accademia", nav: "accademia" },
  corso: { fn: viewCourse, title: "Corso", nav: "accademia" },
  lezione: { fn: viewLesson, title: "Lezione", nav: "accademia" },
  // Sezioni tolte: chi ha un vecchio link torna alla home o all'accademia.
  live: { fn: () => { location.hash = "#/home"; }, title: "" },
  educatori: { fn: () => { location.hash = "#/home"; }, title: "" },
  percorso: { fn: () => { location.hash = "#/accademia"; }, title: "" },
  educatore: { fn: () => { location.hash = "#/accademia"; }, title: "" },
  community: { fn: viewCommunity, title: "Community", nav: "community" },
  guadagni: { fn: () => { location.hash = "#/home"; }, title: "" },
  notizie: { fn: () => { location.hash = "#/home"; }, title: "" },
  profilo: { fn: viewProfile, title: "Profilo", nav: "" },
  "mie-live": { fn: () => { location.hash = "#/home"; }, title: "" },
  notifiche: { fn: viewNotifications, title: "Notifiche", nav: "notifiche" },
  sblocca: { fn: viewShop, title: "Sblocca", nav: "" },
  grazie: { fn: viewThanks, title: "Grazie", nav: "" },
  admin: { fn: viewAdmin, title: "Admin", nav: "admin", admin: true, noRail: true },
  allenati: { fn: () => viewGym([""]), title: "Allenati", nav: "allenati" },
  progressi: { fn: ([t]) => viewGym([t || "risultati"]), title: "Progressi", nav: "progressi" },
  sim: { fn: viewSim, title: "Telefonata", nav: "allenati", noRail: true, incall: true },
  verifica: { fn: viewVerify, auth: false },
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [p, qs] = h.split("?");
  const [name, ...args] = p.split("/");
  return { name: name || "home", args: args.map(decodeURIComponent), q: new URLSearchParams(qs || "") };
}

async function router() {
  closeRadial();
  if (window.speechSynthesis) speechSynthesis.cancel();
  closeSheet();
  const { name, args, q } = parseHash();
  const r = ROUTES[name] || ROUTES.home;
  if (name === "accedi" && !S.user) await loadMe();
  if (r.auth !== false && !S.user) {
    if (!(await loadMe())) { if (name !== "accedi") location.hash = "#/accedi"; else render(); return; }
  }
  if (r.admin && S.user.role !== "admin") { location.hash = "#/home"; return; }
  if (S.user && Date.now() - (S.notifAt || 0) > 20000) { S.notifAt = Date.now(); refreshNotifs(); }
  if (name === "accedi" && S.user) { location.hash = "#/home"; return; }
  if (name === "verifica") { render(r, args, q); return; }
  render(r, args, q);
}

function render(r = ROUTES.accedi, args = [], q = new URLSearchParams()) {
  const logged = r.auth !== false;
  $("#topbar").hidden = !logged;
  $("#nav").hidden = !logged;
  $("#side").hidden = !logged;
  $("#rail").hidden = !logged || !!r.noRail;
  const shell = $(".shell");
  shell.classList.toggle("anon", !logged);
  shell.classList.toggle("noRail", !!r.noRail);
  view.className = logged ? "view" : "view noNav";
  document.body.classList.toggle("incall", !!r.incall);
  if (logged) {
    $("#sideMe").innerHTML = userFace(S.user);
    $("#sideAdmin").hidden = S.user.role !== "admin";
    $("#rail").hidden = true;
    shell.classList.add("noRail");
    $("#title").textContent = r.title;
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.nav));
    paintBell();
  }
  window.scrollTo(0, 0);
  r.fn(args, q);
}

async function loadMe() {
  try {
    const d = await api("/me");
    Object.assign(S, { user: d.user, content: d.content, progress: d.progress || {}, reminders: d.reminders || [], gym: d.gym });
    return true;
  } catch { return false; }
}

$("#sideOut").onclick = async () => {
  try { await api("/logout", {}); } catch {}
  S.user = null;
  location.hash = "#/accedi";
};

// ---------- notifiche ----------
S.notifs = []; S.unread = 0;
function paintBell() {
  const n = S.unread;
  const badge = n ? `<span class="nbadge">${n > 9 ? "9+" : n}</span>` : "";
  $("#liveDot").innerHTML = icon("bell") + badge;
  const sb = $("#sideBell");
  if (sb) sb.innerHTML = icon("bell") + "<span>Notifiche</span>" + badge;
}
let lastNotifId = null;
async function refreshNotifs() {
  if (!S.user) return;
  try {
    const d = await api("/notifications");
    const first = d.notifications[0];
    // Notifica di sistema per le novità arrivate mentre l'app è aperta in un'altra scheda o in background
    if (lastNotifId && first && first.id !== lastNotifId && first.unread && document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification(first.title, { body: first.text, icon: "/app/icon-192.png", tag: first.id });
      n.onclick = () => { window.focus(); location.hash = first.link || "#/notifiche"; };
    }
    lastNotifId = first ? first.id : lastNotifId || "none";
    S.notifs = d.notifications; S.unread = d.unread;
    paintBell();
  } catch {}
}
setInterval(refreshNotifs, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshNotifs(); });

async function viewNotifications() {
  view.innerHTML = `<div class="loading"><div class="spin"></div></div>`;
  await refreshNotifs();
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  view.innerHTML = `
    <h1 class="h1">Notifiche</h1>
    ${perm === "default" ? `<div class="card pad" style="margin-top:14px"><div class="row"><span class="ini" style="width:40px;height:40px;border-radius:12px">${icon("bell")}</span><div class="grow"><b>Avvisi sul telefono</b><p class="small muted">Ricevi un avviso quando esce un nuovo corso o qualcuno applaude un tuo successo.</p></div></div><button class="btn pri block" id="perm" style="margin-top:12px">Attiva gli avvisi</button></div>` : ""}
    <div class="card" style="margin-top:14px">${S.notifs.map((n) => `<a class="nrow ${n.unread ? "unread" : ""}" href="${esc(/^#\//.test(n.link) ? n.link : "#/notifiche")}"><span class="nic">${icon(n.icon || "bell")}</span><div class="grow"><h4>${esc(n.title)}</h4>${n.text ? `<p>${esc(n.text)}</p>` : ""}<small>${ago(n.at)}</small></div>${n.unread ? '<i class="ndot"></i>' : ""}</a>`).join("") || `<div class="empty">${icon("bell")}Nessuna notifica per ora.</div>`}</div>`;
  const pb = $("#perm");
  if (pb) pb.onclick = async () => { const r = await Notification.requestPermission(); toast(r === "granted" ? "Avvisi attivati" : "Avvisi non attivati"); viewNotifications(); };
  if (S.unread) { api("/notifications/read", {}).catch(() => {}); S.unread = 0; paintBell(); }
}

// ---------- radiale ----------
function closeRadial() {}

// =====================================================================
// ACCESSO
// =====================================================================
function viewAuth() {
  let mode = "login";
  const draw = () => {
    view.innerHTML = `<section class="splash">
        <picture><img src="/app/splash.webp" alt="Vendita Uno. Tutto in uno, tutto per te: formazione, strumenti e una community di professionisti per crescere nel settore immobiliare."></picture>
        <div class="splash-cta"><button class="btn pri" data-cta="reg">Inizia gratis</button><button class="btn sec" data-cta="login">Accedi</button></div>
      </section>
      <div class="auth" id="authBox">
      <div class="wm hide-desk" style="font-size:22px;margin-bottom:18px"><span class="v">Vendita</span><span class="u">UNO</span></div>
      <h1 class="hero">${mode === "reg" ? "Crea il tuo <span>account gratuito.</span>" : "Bentornato, <span>accedi.</span>"}</h1>
      <div class="perks">
        <div>${icon("cap")} Corsi passo passo, dalla chiamata al rogito</div>
        <div>${icon("phone")} Allenati al telefono con clienti simulati e ricevi il voto</div>
        <div>${icon("trend")} Punti, classifica e certificati per ogni corso</div>
      </div>
      <div class="seg"><button data-m="reg" class="${mode === "reg" ? "on" : ""}">Registrati</button><button data-m="login" class="${mode === "login" ? "on" : ""}">Accedi</button></div>
      <div id="authErr"></div>
      <form id="authForm" novalidate>
        ${mode === "reg" ? `
          <div class="two"><label class="field"><span>Nome</span><input class="inp" name="name" autocomplete="given-name" required></label>
          <label class="field"><span>Cognome</span><input class="inp" name="surname" autocomplete="family-name" required></label></div>
          <label class="field"><span>Email</span><input class="inp" name="email" type="email" autocomplete="email" required></label>
          <div class="two"><label class="field"><span>Telefono</span><input class="inp" name="phone" type="tel" autocomplete="tel"></label>
          <label class="field"><span>Città</span><input class="inp" name="city" autocomplete="address-level2"></label></div>
          <label class="field"><span>Agenzia (facoltativo)</span><input class="inp" name="agency" autocomplete="organization"></label>
          <label class="field"><span>Password (almeno 8 caratteri)</span><input class="inp" name="password" type="password" autocomplete="new-password" required></label>
          <button class="btn pri block" type="submit">Crea il mio account</button>
          <p class="small muted" style="margin-top:12px;text-align:center">Registrandoti accetti i <a href="/termini.html" target="_blank">termini</a> e la <a href="/privacy.html" target="_blank">privacy</a>.</p>`
        : `
          <label class="field"><span>Email</span><input class="inp" name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Password</span><input class="inp" name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn pri block" type="submit">Accedi</button>`}
      </form></div>`;
    view.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); $("#authBox").scrollIntoView(); }));
    view.querySelectorAll("[data-cta]").forEach((b) => (b.onclick = () => { mode = b.dataset.cta; draw(); $("#authBox").scrollIntoView({ behavior: "smooth" }); }));
    $("#authForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button[type=submit]");
      const data = Object.fromEntries(new FormData(e.target));
      btn.disabled = true;
      try {
        await api(mode === "reg" ? "/register" : "/login", data);
        await loadMe();
        refreshNotifs();
        location.hash = "#/home";
        if (mode === "reg") toast(`Benvenuto, ${S.user.name}!`);
      } catch (err) {
        $("#authErr").innerHTML = `<div class="err">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    };
  };
  draw();
}

// =====================================================================
// HOME: la tua giornata
// =====================================================================
const romeDay = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
function todayTasks() {
  const g = gymNow(), today = romeDay(Date.now()), nl = nextLesson();
  const lessonToday = Object.values(S.progress || {}).some((t) => romeDay(t) === today);
  return [
    { done: lessonToday, ic: "play", t: "Guarda una lezione", s: nl ? nl.title : "Le lezioni arrivano presto", href: nl ? `#/lezione/${nl.id}` : "#/accademia" },
    { done: g.simToday > 0, ic: "phone", t: "Fai una telefonata", s: g.simToday ? `${g.simToday} ${g.simToday === 1 ? "fatta" : "fatte"} oggi` : "Un cliente difficile ti aspetta", href: "#/allenati" },
    { done: !!g.resToday, ic: "trend", t: "Segna i risultati", s: "Chiamate, appuntamenti, incarichi", href: "#/progressi" },
  ];
}
// Le tappe del percorso: una per sezione dell'Accademia, con il suo numero gigante.
function pathSteps() {
  const a = S.content.academies[0] || { subs: [] };
  let currentSet = false;
  return (a.subs || []).map((sb, i) => {
    const les = S.content.modules.filter((m) => m.subId === sb.id).flatMap((m) => m.lessons);
    const d = les.filter((l) => S.progress[l.id]).length;
    const state = !les.length ? "soon" : d === les.length ? "done" : !currentSet ? "now" : "todo";
    if (state === "now") currentSet = true;
    return { id: sb.id, n: i + 1, name: sb.name, c: SUB_COLORS[i % SUB_COLORS.length], all: les.length, done: d, pct: les.length ? Math.round((d / les.length) * 100) : 0, state };
  });
}
function pathHtml() {
  const steps = pathSteps();
  if (!steps.length) return "";
  return `<div class="path7">${steps.map((s) => `<a class="step7 ${s.state}" href="#/accademia?sez=${esc(s.id)}" style="--c:${s.c}">
      <b class="n7">${s.n}</b>
      <span class="s7-st">${s.state === "done" ? `${icon("check", "sm")}Fatta` : s.state === "now" ? "Sei qui" : s.state === "soon" ? "In arrivo" : `${s.all} lezioni`}</span>
      <h3>${esc(s.name)}</h3>
      <div class="prog"><i style="width:${s.pct}%"></i></div>
    </a>`).join("")}</div>`;
}
function ringSvg(done, tot, r = 34) {
  const C = 2 * Math.PI * r, sz = (r + 7) * 2;
  return `<svg viewBox="0 0 ${sz} ${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" class="trk"/><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" class="val" style="--c0:${C};stroke-dasharray:${C};stroke-dashoffset:${C * (1 - (tot ? done / tot : 0))}"/></svg>`;
}
function viewHome() {
  const g = gymNow(), lv = levelOf(g.xp), tasks = todayTasks(), done = tasks.filter((t) => t.done).length;
  const ls = allLessons(), doneL = ls.filter((l) => S.progress[l.id]).length, nl = nextLesson();
  const day = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  view.innerHTML = `
    <header class="stage">
      <div class="st-row">
        <div class="grow"><p class="st-k">${esc(day)}</p><h1>Ciao ${esc(S.user.name)}</h1></div>
        <a class="st-ring" href="#/progressi" aria-label="${done} su 3 fatte oggi">${ringSvg(done, 3)}<b>${done}<small>/3</small></b></a>
      </div>
      <div class="st-chips">
        <a class="st-chip" href="#/progressi/classifica">${lvlBadge(lv, 26)}<span><b>${esc(lv.name)}</b>${g.xp} punti</span></a>
        <a class="st-chip ${g.streak ? "hot" : ""}" href="#/progressi">${flame(g.streak > 0)}<span><b>${g.streak} ${g.streak === 1 ? "giorno" : "giorni"}</b>di fila</span></a>
      </div>
    </header>
    <div class="body">
      <section class="today3">
        <div class="t3-hd"><h2>Oggi</h2><p>${done === 3 ? "Fatto tutto. Domani si ricomincia." : `Fai queste ${3 - done === 1 ? "ultima cosa" : `${3 - done} cose`} e tieni viva la serie`}</p></div>
        <div class="t3-grid">${tasks.map((t, i) => `<a class="t3 ${t.done ? "done" : ""}" href="${esc(t.href)}">
          <b class="t3-n">${i + 1}</b><span class="t3-ic">${icon(t.done ? "check" : t.ic)}</span>
          <h3>${esc(t.t)}</h3><p>${esc(t.s)}</p></a>`).join("")}</div>
      </section>
      ${nl ? `<a class="resume" href="#/lezione/${esc(nl.id)}">
        <div class="rs-cov">${coverBg(nl.module.cover, courseColor(nl.module), subNum(nl.module))}<span class="rs-play">${icon("play")}</span></div>
        <div class="rs-tx"><small>${doneL ? "Riprendi da qui" : "Inizia da qui"} · ${esc(nl.module.title)}</small><h3>${esc(nl.title)}</h3>
        <div class="prog"><i style="width:${ls.length ? Math.round((doneL / ls.length) * 100) : 0}%"></i></div><p>${doneL} di ${ls.length} lezioni dell'Accademia</p></div></a>` : ""}
      ${secHd("Il tuo percorso", null, `<a href="#/accademia">Accademia</a>`)}
      ${pathHtml()}
      <a class="callcta" href="#/allenati"><span class="cc-ic">${icon("phone")}</span><div class="grow"><h3>Chiama un cliente difficile</h3><p>Ti risponde l'AI. Alla fine ricevi il voto.</p></div>${icon("chev")}</a>
      <div id="homeWins"></div>
    </div>`;
  paintHomeWins();
}

// =====================================================================
// ACCADEMIA
// =====================================================================
// Le sezioni sono un percorso in ordine: si mostrano tutte, anche quelle con i corsi in arrivo.
function viewAcademy(_, q) {
  const ls = allLessons(), done = ls.filter((l) => S.progress[l.id]).length, pct = ls.length ? Math.round((done / ls.length) * 100) : 0;
  const certs = Object.keys(S.user.certs || {}).length, saved = S.user.saved || [];
  const steps = pathSteps(), ids = new Set(steps.map((x) => x.id));
  const other = S.content.modules.filter((m) => !ids.has(m.subId));
  const block = (b) => {
    const ms = b.ms || S.content.modules.filter((m) => m.subId === b.id);
    return `<section class="acs ${b.state}" id="sez-${esc(b.id)}" style="--c:${b.c}">
      <div class="acs-hd"><b class="acs-n">${b.n}</b>
        <div class="grow"><h2>${esc(b.name)}</h2><p>${ms.length ? `${ms.length} ${ms.length === 1 ? "corso" : "corsi"} · ${b.all} ${b.all === 1 ? "lezione" : "lezioni"}${b.done ? ` · ${b.state === "done" ? "completata" : `${b.done} fatte`}` : ""}` : "Corsi in arrivo"}</p></div>
        ${b.state === "done" ? `<span class="acs-ok">${icon("check", "sm")}</span>` : b.state === "now" ? `<span class="acs-now">Sei qui</span>` : ""}</div>
      ${ms.length ? `<div class="hcourses">${ms.map(courseCard).join("")}</div>` : ""}
    </section>`;
  };
  view.innerHTML = `
    <header class="stage">
      <div class="st-row">
        <div class="grow"><p class="st-k">${steps.length} tappe · ${S.content.modules.length} corsi · ${ls.length} lezioni</p><h1>Accademia</h1></div>
        <div class="st-ring">${ringSvg(done, ls.length)}<b>${pct}<small>%</small></b></div>
      </div>
      <div class="st-chips">
        <span class="st-chip">${icon("play", "sm")}<span><b>${done}</b>lezioni fatte</span></span>
        <span class="st-chip">${icon("doc", "sm")}<span><b>${certs}</b>${certs === 1 ? "certificato" : "certificati"}</span></span>
      </div>
    </header>
    <div class="body">
      ${saved.length ? `${secHd("Salvati")}<div class="hcourses">${S.content.modules.filter((m) => saved.includes(m.id)).map(courseCard).join("")}</div>` : ""}
      <div class="acs-list">${steps.map(block).join("")}${other.length ? block({ id: "_altri", n: "+", name: "Altri corsi", c: "#5d6678", ms: other, all: other.flatMap((m) => m.lessons).length, done: 0, state: "todo" }) : ""}</div>
    </div>`;
  bindCourses(view);
  const sez = q && q.get("sez");
  if (sez) { const el = document.getElementById(`sez-${sez}`); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50); }
}

function viewCourse([id]) {
  const m = courseById(id);
  if (!m) { location.hash = "#/accademia"; return; }
  const a = academyById(m.academyId), e = eduById(m.educatorId), c = courseColor(m), st = courseStats(m);
  const next = m.lessons.find((l) => !S.progress[l.id]) || m.lessons[0];
  const saved = (S.user.saved || []).includes(m.id);
  view.innerHTML = `
    <div class="chero">${coverBg(m.cover, c, subNum(m))}
      <a class="back" href="#/accademia">${icon("back", "sm")} Accademia</a>
      <div class="info">
        <div class="row" style="gap:8px;flex-wrap:wrap">${a ? `<a class="chip" href="#/accademia?sez=${esc(m.subId || "")}" style="background:${c};color:#fff;text-decoration:none">${esc(subOf(m) ? subOf(m).name : a.name)}</a>` : ""}<span class="lvl ${m.level === "premium" ? "premium" : "base"}">${m.level === "premium" ? "Premium" : "Base"}</span></div>
        <h1>${esc(m.title)}</h1>
        ${e ? `<div class="row" style="gap:8px;margin-top:10px;font-size:13px;color:#e3e8f3">${face(e.name, e.photo)}${esc(e.name)}</div>` : ""}
      </div>
    </div>
    <div class="narrow">
    ${m.desc ? `<p class="lead-tx" style="line-height:1.55;margin-top:16px">${esc(m.desc)}</p>` : ""}
    <div class="card pad" style="margin-top:16px"><div class="row"><div class="grow"><b style="font-family:var(--display);font-size:15px">${st.done} di ${st.all} lezioni</b><div class="prog" style="margin-top:8px"><i style="width:${st.pct}%"></i></div></div><span style="font-family:var(--display);font-weight:800;font-size:22px">${st.pct}%</span></div>
    <div class="btns">${!canCourse(m) ? `<button class="btn pri" data-unlock>${icon("lock", "sm")}Sblocca il corso</button>` : next ? `<a class="btn pri" href="#/lezione/${esc(next.id)}">${icon("play", "sm")}${st.done ? "Continua" : "Inizia"}</a>` : `<span></span>`}<button class="btn sec ${saved ? "on" : ""}" data-save="${esc(m.id)}">${icon(saved ? "check" : "plus", "sm")}${saved ? "Salvato" : "Salva"}</button></div></div>
    ${canCourse(m) && st.all && st.done === st.all ? certBox(m) : ""}
    <h2 class="sec">Lezioni</h2>
    <div class="card">${m.lessons.map((l, i) => `<a class="les" href="#/lezione/${esc(l.id)}"><span class="st ${S.progress[l.id] ? "done" : ""}">${!canCourse(m) ? icon("lock", "sm") : S.progress[l.id] ? icon("check", "sm") : i + 1}</span><div class="grow"><h4>${esc(l.title)}</h4><p>${l.minutes ? l.minutes + " min" : "Video"}${l.pdf ? " · PDF" : ""}</p></div>${icon("chev", "sm")}</a>`).join("") || `<div class="empty">Le lezioni arrivano presto.</div>`}</div>
    </div>`;
  const ub = view.querySelector("[data-unlock]");
  if (ub) ub.onclick = () => openUnlock(`course:${m.id}`, m.title);
  if (!canCourse(m)) view.querySelectorAll(".les").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); openUnlock(`course:${m.id}`, m.title); }));
  const cd = $("#certDl");
  if (cd) cd.onclick = async () => { const had = (S.user.certs || {})[m.id]; if ((await downloadCert(m, cd)) && !had) viewCourse([id]); };
  const sb = view.querySelector("[data-save]");
  sb.onclick = async () => {
    try { S.user = (await api("/save", { courseId: m.id, on: !saved })).user; viewCourse([id]); toast(saved ? "Tolto dai tuoi corsi" : "Salvato nei tuoi corsi"); } catch (err) { toast(err.message); }
  };
}

function viewLesson([id]) {
  const ls = allLessons(), i = ls.findIndex((l) => l.id === id);
  if (i < 0) { location.hash = "#/accademia"; return; }
  const l = ls[i], prev = ls[i - 1], next = ls[i + 1];
  const vurl = lessonVideo(l);
  if (!canCourse(l.module)) {
    lockedView(`course:${l.module.id}`, l.module.title, "Questo corso è bloccato: sbloccalo per guardare le lezioni.");
    return;
  }
  const draw = () => {
    const done = !!S.progress[l.id];
    view.innerHTML = `
      <div class="les-wrap"><a class="back" href="#/corso/${esc(l.module.id)}">${icon("back", "sm")} ${esc(l.module.title)}</a>
      ${playerHtml(vurl, l.title)}
      <div class="small" style="color:var(--blue-3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-top:16px">${esc(l.module.title)} · lezione ${l.module.lessons.indexOf(S.content.modules[l.mi].lessons.find((x) => x.id === l.id)) + 1} di ${l.module.lessons.length}</div>
      <h1 class="h1" style="font-size:22px;margin-top:4px">${esc(l.title)}</h1>
      ${l.desc ? `<p class="lead-tx" style="line-height:1.55;white-space:pre-wrap">${esc(l.desc)}</p>` : ""}
      ${safeUrl(l.pdf) ? `<a class="card teaser" href="${esc(safeUrl(l.pdf))}" target="_blank" rel="noopener"><span class="lk">${icon("doc")}</span><div class="grow"><h4>Materiale della lezione</h4><p>Scarica il PDF</p></div>${icon("chev")}</a>` : ""}
      ${(l.quiz || []).length ? quizHtml(l) : ""}
      <button class="btn ${done ? "on sec" : "pri"} block" id="done" style="margin-top:16px">${icon("check", "sm")}${done ? "Completata" : "Segna come completata"}</button>
      <div class="les-nav">
        ${prev ? `<a class="btn sec" href="#/lezione/${esc(prev.id)}">${icon("back", "sm")}Precedente</a>` : "<span></span>"}
        ${next ? `<a class="btn sec" href="#/lezione/${esc(next.id)}">Successiva${icon("chev", "sm")}</a>` : "<span></span>"}
      </div></div>`;
    const qg = $("#quizGo");
    if (qg) qg.onclick = () => runQuiz(l, () => { if (next) location.hash = `#/lezione/${next.id}`; else draw(); });
    $("#done").onclick = async () => {
      try {
        const d = await api("/progress", { lessonId: l.id, done: !done });
        S.progress = d.progress;
        gain({ ...d, gained: 0 });
        if (d.gained) toast(`Lezione completata · +${d.gained} punti`);
        if (!done && next) { if (!d.gained) toast("Lezione completata"); location.hash = `#/lezione/${next.id}`; }
        else { if (!done) toast("Hai finito l'accademia!"); draw(); }
      } catch (e) { toast(e.message); }
    };
  };
  draw();
}

// =====================================================================
// COMMUNITY
// =====================================================================
function postHtml(p) {
  const edu = p.educatorId ? eduById(p.educatorId) : null;
  const badge = edu || p.role === "admin" ? `<svg class="verified"><use href="#i-badge"/></svg>` : "";
  const label = edu ? "Educatore" : p.role === "admin" ? "Vendita Uno" : p.city ? `Agente · ${esc(p.city)}` : "Agente";
  const photo = edu && safeUrl(edu.photo) ? edu.photo : imgUrl(p.avatar);
  return `<div class="card post" data-key="${esc(p.key)}">
    <div class="hd">${face(p.author, photo)}<div class="grow"><b>${esc(p.author)}${badge}</b><small>${label} · ${ago(p.at)}</small></div>
    ${p.mine || S.user.role === "admin" ? `<button data-del aria-label="Elimina" style="color:var(--dim)">${icon("trash", "sm")}</button>` : ""}</div>
    <div class="tx">${esc(p.text)}</div>
    ${p.image ? `<div class="media"><img src="${imgUrl(p.image)}" alt="" loading="lazy"></div>` : ""}
    <div class="ft"><button data-like class="${p.liked ? "liked" : ""}">${icon("heart")}${p.likes}</button><button data-cm>${icon("comment")}${p.comments.length}</button></div>
    <div class="comments" hidden></div>
  </div>`;
}

function bindPosts(root, posts) {
  const byKey = Object.fromEntries(posts.map((p) => [p.key, p]));
  root.querySelectorAll(".post").forEach((el) => { if (byKey[el.dataset.key]) bindPost(el, byKey[el.dataset.key]); });
}

function bindPost(el, p) {
    const rerender = (np) => {
      Object.assign(p, np);
      const tmp = document.createElement("div");
      tmp.innerHTML = postHtml(p);
      const fresh = tmp.firstElementChild;
      const wasOpen = !el.querySelector(".comments").hidden;
      el.replaceWith(fresh);
      bindPost(fresh, p);
      if (wasOpen) fresh.querySelector("[data-cm]").click();
    };
    el.querySelector("[data-like]").onclick = async () => {
      try { rerender((await api(`/posts/${p.key}/like`, { on: !p.liked })).post); } catch (e) { toast(e.message); }
    };
    el.querySelector("[data-cm]").onclick = () => {
      const box = el.querySelector(".comments");
      box.hidden = !box.hidden;
      if (box.hidden) return;
      box.innerHTML = p.comments.map((c) => `<div class="cm">${face(c.author, imgUrl(c.avatar))}<div><b>${esc(c.author)}</b>${esc(c.text)}</div></div>`).join("") +
        `<form class="cm-form"><input placeholder="Scrivi un commento…" maxlength="1000"><button>Invia</button></form>`;
      const f = box.querySelector("form");
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const t = f.querySelector("input").value.trim();
        if (!t) return;
        try { rerender((await api(`/posts/${p.key}/comment`, { text: t })).post); } catch (e) { toast(e.message); }
      };
      f.querySelector("input").focus();
    };
    const del = el.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      if (!confirm("Eliminare questo post?")) return;
      try { await api(`/posts/${p.key}/delete`, {}); el.remove(); toast("Post eliminato"); } catch (e) { toast(e.message); }
    };
}

async function viewCommunity(_, q) {
  if (!can("community")) { lockedView("community", "Community bloccata", "Sblocca la community per leggere e scrivere con gli altri agenti e con gli educatori."); return; }
  let image = "";
  view.innerHTML = `
    <header class="stage"><div class="st-row"><div class="grow"><p class="st-k">Agenti Vendita Uno</p><h1>Community</h1><p class="st-sub">Domande, consigli e risultati di chi lavora col metodo.</p></div></div>
      <button class="btn white" id="shareW" style="margin-top:16px">${icon("spark", "sm")}Condividi un successo</button></header>
    <div class="body">
    <div id="homeWins"></div>
    <h2 class="sec">Bacheca</h2>
    <div class="card compose">
      <div class="row" style="align-items:flex-start">${userFace(S.user)}<textarea id="ptx" placeholder="Racconta un incarico preso, fai una domanda…" maxlength="2000" rows="2"></textarea></div>
      <div class="prev" id="pprev" hidden></div>
      <div class="bar"><label style="color:var(--blue-2);cursor:pointer;display:flex">${icon("image")}<input type="file" accept="image/*" id="pimg" hidden></label><button class="btn pri" id="psend">Pubblica</button></div>
    </div>
    <div id="feed"><div class="loading" style="min-height:120px"><div class="spin"></div></div></div>
    <div id="more"></div></div>`;
  view.querySelector(".compose .av, .compose .ini").style.cssText = "width:34px;height:34px;font-size:12px";
  paintHomeWins();
  $("#shareW").onclick = () => shareWin(paintHomeWins);
  const tx = $("#ptx");
  tx.oninput = () => { tx.style.height = "auto"; tx.style.height = tx.scrollHeight + "px"; };
  if (q.get("scrivi")) setTimeout(() => tx.focus(), 50);
  $("#pimg").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      image = await resizeImage(f, 1280, 0.8);
      $("#pprev").hidden = false;
      $("#pprev").innerHTML = `<img src="${image}" alt=""><button aria-label="Rimuovi">${icon("x", "sm")}</button>`;
      $("#pprev button").onclick = () => { image = ""; $("#pprev").hidden = true; $("#pimg").value = ""; };
    } catch (err) { toast(err.message); }
  };
  $("#psend").onclick = async () => {
    const text = tx.value.trim();
    if (!text) { tx.focus(); return; }
    $("#psend").disabled = true;
    try {
      const d = await api("/posts", { text, image });
      tx.value = ""; image = ""; $("#pprev").hidden = true; $("#pimg").value = "";
      const tmp = document.createElement("div");
      tmp.innerHTML = postHtml(d.post);
      const feed = $("#feed");
      if (feed.querySelector(".empty")) feed.innerHTML = "";
      feed.prepend(tmp.firstElementChild);
      bindPosts(feed, [d.post]);
      toast("Pubblicato");
    } catch (e) { toast(e.message); }
    $("#psend").disabled = false;
  };
  const load = async (cursor) => {
    try {
      const d = await api(`/posts${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`);
      const feed = $("#feed");
      if (!feed) return;
      if (!cursor) feed.innerHTML = "";
      const box = document.createElement("div");
      box.innerHTML = d.posts.map(postHtml).join("");
      feed.append(...box.children);
      bindPosts(feed, d.posts);
      if (!cursor && !d.posts.length) feed.innerHTML = `<div class="card empty">${icon("feed")}Ancora nessun post. Scrivi tu il primo!</div>`;
      $("#more").innerHTML = d.cursor ? `<button class="btn sec block">Carica altri</button>` : "";
      if (d.cursor) $("#more button").onclick = () => load(d.cursor);
    } catch (e) { $("#feed").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  load();
}

// =====================================================================
// GUADAGNI E INVITI
// =====================================================================
// ---------- PDF di presentazione con il link invito personale ----------
const loaded = {};
function loadScript(src) {
  return loaded[src] || (loaded[src] = new Promise((ok, ko) => {
    const el = document.createElement("script");
    el.src = src; el.onload = ok; el.onerror = () => { delete loaded[src]; ko(new Error("Connessione assente, riprova")); };
    document.head.appendChild(el);
  }));
}
// Il font standard del PDF non ha alcuni simboli: li sostituisce con equivalenti semplici.
const pdfText = (t) => String(t || "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/›/g, ">").replace(/[^\x20-\x7E -ÿ€]/g, "");

function viewShop() {
  const list = S.content.products || [];
  view.innerHTML = `<h1 class="h1">Sblocca i contenuti</h1><p class="lead-tx">Scegli cosa vuoi sbloccare. Paghi in modo sicuro con Stripe e l'accesso si attiva da solo.</p>
    ${list.length ? `<div class="prods" style="margin-top:16px">${productsHtml(list)}</div>` : `<div class="card empty" style="margin-top:16px">${icon("lock")}Al momento non ci sono prodotti da acquistare.</div>`}`;
}
async function viewThanks() {
  view.innerHTML = `<div class="lockbox" style="margin:40px auto"><span class="lk" style="background:#e7f6ec;color:#15803d">${icon("check")}</span><h2>Grazie per l'acquisto!</h2><p id="thx">Stiamo attivando il tuo accesso…</p><a class="btn pri block" href="#/accademia">Vai all'accademia</a></div>`;
  const before = JSON.stringify(S.user.access);
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    await loadMe();
    if (JSON.stringify(S.user.access) !== before) { const t = $("#thx"); if (t) t.textContent = "Fatto: i contenuti sono sbloccati."; return; }
  }
  const t = $("#thx"); if (t) t.textContent = "Il pagamento è registrato: l'accesso si attiva entro pochi minuti. Se non succede, scrivici.";
}

// =====================================================================
// PROFILO
// =====================================================================
function viewProfile() {
  const u = S.user;
  const roleName = { admin: "Amministratore", educator: "Educatore", agent: "Agente" }[u.role] || "Agente";
  view.innerHTML = `
    <header class="stage"><div class="me-hd">
      <div class="avedit">${userFace(u)}<label aria-label="Cambia foto">${icon("camera")}<input type="file" accept="image/*" id="avf" hidden></label></div>
      <div class="grow"><h1>${esc(fullName(u))}</h1><p class="st-sub">${roleName}${u.city ? " · " + esc(u.city) : ""}</p></div>
    </div></header>
    <div class="body">
    <div class="card menu">
      <a href="#/allenati">${icon("phone")}Allenati, risultati e classifica${icon("chev", "chev")}</a>
      ${fullAccess() ? "" : `<a href="#/sblocca">${icon("key")}Sblocca i contenuti${icon("chev", "chev")}</a>`}
      ${u.role === "admin" ? `<a href="#/admin">${icon("shield")}Pannello admin${icon("chev", "chev")}</a>` : `<button id="claim">${icon("key")}Ho un codice amministratore${icon("chev", "chev")}</button>`}
    </div>
    <h2 class="sec">I tuoi dati</h2>
    <form class="card pad" id="pf">
      <div class="two"><label class="field"><span>Nome</span><input class="inp" name="name" value="${esc(u.name)}"></label><label class="field"><span>Cognome</span><input class="inp" name="surname" value="${esc(u.surname)}"></label></div>
      <div class="two"><label class="field"><span>Telefono</span><input class="inp" name="phone" type="tel" value="${esc(u.phone || "")}"></label><label class="field"><span>Città</span><input class="inp" name="city" value="${esc(u.city || "")}"></label></div>
      <label class="field"><span>Agenzia</span><input class="inp" name="agency" value="${esc(u.agency || "")}"></label>
      <p class="small muted" style="margin-bottom:12px">Email: ${esc(u.email)}</p>
      <button class="btn pri block">Salva</button>
    </form>
    <h2 class="sec">Password</h2>
    <form class="card pad" id="pwf">
      <label class="field"><span>Password attuale</span><input class="inp" name="old" type="password" autocomplete="current-password"></label>
      <label class="field"><span>Nuova password</span><input class="inp" name="password" type="password" autocomplete="new-password"></label>
      <button class="btn sec block">Cambia password</button>
    </form>
    <button class="btn danger block" id="logout" style="margin-top:20px">${icon("logout", "sm")}Esci</button></div>`;
  const cl = $("#claim");
  if (cl) cl.onclick = () => formSheet("Accesso amministratore", field("Codice amministratore", "code", "", "text", 'required autocomplete="off" placeholder="VU-XXXX-XXXX-XXXX" style="text-transform:uppercase"'), async (f) => {
    S.user = (await api("/admin-claim", { code: f.code })).user;
    closeSheet();
    toast("Ora sei amministratore");
    location.hash = "#/admin";
  });
  $("#avf").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { S.user = (await api("/avatar", { dataUrl: await resizeImage(f, 480) })).user; await loadMe(); toast("Foto aggiornata"); viewProfile(); } catch (err) { toast(err.message); }
  };
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    try { S.user = (await api("/profile", Object.fromEntries(new FormData(e.target)))).user; toast("Dati salvati"); viewProfile(); } catch (err) { toast(err.message); }
  };
  $("#pwf").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/password", Object.fromEntries(new FormData(e.target))); e.target.reset(); toast("Password cambiata"); } catch (err) { toast(err.message); }
  };
  $("#logout").onclick = async () => {
    try { await api("/logout", {}); } catch {}
    S.user = null;
    location.hash = "#/accedi";
  };
}

// =====================================================================
// ADMIN
// =====================================================================
const ICONS = ["key", "handshake", "phone", "mega", "brain", "euro", "doc", "spark", "trend", "tool", "home2", "cap", "camera", "users"];
let adminTab = "overview";

function viewAdmin() {
  const tabs = [["overview", "Panoramica"], ["accademia", "Corsi"], ["utenti", "Utenti"], ["vendite", "Vendite"], ["prodotti", "Prodotti"], ["educatori", "Educatori"], ["percorsi", "Sezioni"]];
  view.innerHTML = `<h1 class="h1">Pannello admin</h1><p class="lead-tx" style="margin-bottom:14px">Qui gestisci corsi, quiz, utenti e vendite dell'app.</p>
    <div class="tabs">${tabs.map(([k, n]) => `<button data-a="${k}" class="${adminTab === k ? "on" : ""}">${n}</button>`).join("")}</div><div id="adm"></div>`;
  view.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => { adminTab = b.dataset.a; await loadMe(); viewAdmin(); }));
  ({ overview: admOverview, vendite: admSales, prodotti: admProducts, accademia: admModules, educatori: admEducators, percorsi: admAcademies, utenti: admUsers })[adminTab]();
}

async function saveSection(section, data, msg = "Salvato") {
  const d = await api("/admin/content", { section, data });
  S.content = d.content;
  toast(msg);
  closeSheet();
  viewAdmin();
}

const field = (label, name, value = "", type = "text", extra = "") =>
  type === "textarea"
    ? `<label class="field"><span>${label}</span><textarea class="inp" name="${name}" rows="3" ${extra}>${esc(value)}</textarea></label>`
    : `<label class="field"><span>${label}</span><input class="inp" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select = (label, name, options, value) =>
  `<label class="field"><span>${label}</span><select class="inp" name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
// Campo foto/copertina: carica, ridimensiona e salva l'indirizzo in un campo nascosto.
const imgField = (label, name, value, wide = false) =>
  `<div class="field"><span>${label}</span><div class="row"><span data-prev="${name}" style="width:${wide ? 96 : 52}px;height:52px;border-radius:${wide ? 10 : 26}px;overflow:hidden;background:var(--panel-2) center/cover no-repeat;flex:none;${safeUrl(value) ? `background-image:url('${esc(safeUrl(value))}')` : ""}"></span>
   <label class="btn sec" style="cursor:pointer">${icon("camera", "sm")}Carica<input type="file" accept="image/*" data-img="${name}" data-wide="${wide ? 1 : ""}" hidden></label>
   <button type="button" class="btn sec" data-clear="${name}" style="padding:12px">${icon("trash", "sm")}</button></div>
   <input type="hidden" name="${name}" value="${esc(value || "")}"></div>`;
function bindImgFields(root) {
  root.querySelectorAll("[data-img]").forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const d = await api("/admin/image", { dataUrl: await resizeImage(f, inp.dataset.wide ? 1400 : 480, 0.82) });
      root.querySelector(`input[name="${inp.dataset.img}"]`).value = d.url;
      root.querySelector(`[data-prev="${inp.dataset.img}"]`).style.backgroundImage = `url('${d.url}')`;
      toast("Immagine caricata");
    } catch (err) { toast(err.message); }
  }));
  root.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = () => {
    root.querySelector(`input[name="${b.dataset.clear}"]`).value = "";
    root.querySelector(`[data-prev="${b.dataset.clear}"]`).style.backgroundImage = "";
  }));
}
const COLORS = [["#2f6bff", "Blu"], ["#7c5cff", "Viola"], ["#0ea5e9", "Azzurro"], ["#06b6d4", "Turchese"], ["#22c55e", "Verde"], ["#eab308", "Oro"], ["#f97316", "Arancione"], ["#ef4444", "Rosso"], ["#ec4899", "Rosa"], ["#64748b", "Grigio"]];

const itemActs = (i, n, extraUp = true) => `<div class="acts">${extraUp && i > 0 ? `<button data-up="${i}" aria-label="Su">${icon("up")}</button>` : ""}<button data-edit="${i}" aria-label="Modifica">${icon("edit")}</button><button data-del="${i}" aria-label="Elimina">${icon("trash")}</button></div>`;

function formSheet(title, html, onSave, onDelete) {
  openSheet(title, `<form id="sf" novalidate>${html}<div id="serr"></div><button class="btn pri block">Salva</button>${onDelete ? `<button type="button" class="btn danger block" id="sdel" style="margin-top:8px">${icon("trash", "sm")}Elimina</button>` : ""}</form>`, (root) => {
    root.querySelector("#sf").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target, serr = root.querySelector("#serr");
      // Link scritti senza https:// (es. youtube.com/...): li completa l'app
      form.querySelectorAll('[inputmode="url"], [name=video], [name=onboardingVideo]').forEach((i) => { const v = i.value.trim(); i.value = v && !/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+\//.test(v) ? "https://" + v : v; });
      const bad = [...form.elements].find((i) => i.willValidate && !i.checkValidity());
      if (bad) {
        const label = (bad.closest(".field") || {}).querySelector ? bad.closest(".field").querySelector("span").textContent : "un campo";
        serr.innerHTML = `<div class="err">Controlla il campo "${esc(label)}": ${esc(bad.validationMessage)}</div>`;
        bad.focus();
        return;
      }
      const btn = form.querySelector("button.pri");
      btn.disabled = true;
      try { await onSave(Object.fromEntries(new FormData(form)), form); } catch (err) { root.querySelector("#serr").innerHTML = `<div class="err">${esc(err.message)}</div>`; btn.disabled = false; }
    };
    bindImgFields(root);
    if (onDelete) root.querySelector("#sdel").onclick = () => { if (confirm("Sicuro di voler eliminare?")) onDelete().catch((err) => toast(err.message)); };
  });
}

function bindList(root, list, section, edit) {
  root.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => edit(Number(b.dataset.edit))));
  root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const item = list[Number(b.dataset.del)];
    if (!confirm(`Sicuro di voler eliminare ${item.name || item.title || "questo elemento"}?`)) return;
    const copy = list.slice(); copy.splice(Number(b.dataset.del), 1);
    saveSection(section, copy, "Eliminato").catch((e) => toast(e.message));
  }));
  root.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.up), copy = list.slice();
    [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
    saveSection(section, copy, "Ordine aggiornato").catch((e) => toast(e.message));
  }));
}

function admModules() {
  const mods = S.content.modules;
  $("#adm").innerHTML = `<button class="btn pri block" id="add">${icon("plus", "sm")}Nuovo corso</button>
    <div style="margin-top:14px">${mods.map((m, i) => `<div class="card" style="margin-bottom:10px;overflow:hidden">
      <div class="adm-item"><span class="ini" style="width:30px;height:30px;font-size:12px;border-radius:9px;background:${accColor(academyById(m.academyId))}">${i + 1}</span><div class="grow"><h4>${esc(m.title)}</h4><p>${m.lessons.length} lezioni · ${esc((academyById(m.academyId) || {}).name || "—")}${subOf(m) ? " › " + esc(subOf(m).name) : ""} · ${m.level === "premium" ? "Premium" : "Base"}</p></div>${itemActs(i, mods.length)}</div>
      ${m.lessons.map((l, j) => `<div class="sub-l">${icon("play", "sm")}<span class="grow ell">${esc(l.title)}</span>${lessonVideo(l) ? `<span class="chip ghost">${esc((videoSrc(lessonVideo(l)) || { kind: "link" }).kind)}</span>` : '<span class="chip warn">no video</span>'}<button data-les="${i}.${j}" aria-label="Modifica lezione">${icon("edit", "sm")}</button></div>`).join("")}
      <div class="sub-l" style="gap:16px"><button data-les="${i}.-1" style="color:var(--blue-2);font-weight:600;display:flex;gap:6px;align-items:center">${icon("plus", "sm")}Aggiungi lezione</button><button data-bulk="${i}" style="color:var(--blue-2);font-weight:600;display:flex;gap:6px;align-items:center">${icon("doc", "sm")}Aggiungi più lezioni</button></div>
    </div>`).join("")}</div>`;
  const edit = (i) => {
    const m = i >= 0 ? mods[i] : { title: "", desc: "", lessons: [], academyId: (S.content.academies[0] || {}).id, educatorId: "", level: "base", cover: "" };
    formSheet(i >= 0 ? "Modifica corso" : "Nuovo corso",
      field("Titolo", "title", m.title, "text", "required") + field("Descrizione", "desc", m.desc, "textarea") +
      select("Accademia e sezione", "place", S.content.academies.flatMap((a) => [[`${a.id}|`, `${a.name}`], ...(a.subs || []).map((sb) => [`${a.id}|${sb.id}`, `${a.name} › ${sb.name}`])]), `${m.academyId}|${m.subId || ""}`) +
      select("Livello", "level", [["base", "Base"], ["premium", "Premium"]], m.level) +
      select("Educatore", "educatorId", [["", "Nessuno"], ...S.content.educators.map((e) => [e.id, e.name])], m.educatorId) +
      imgField("Copertina (1600 × 1000 px, se vuota la creiamo noi)", "cover", m.cover, true),
      async (f) => { [f.academyId, f.subId] = f.place.split("|"); delete f.place; const copy = mods.slice(); if (i >= 0) copy[i] = { ...m, ...f }; else copy.push({ ...m, ...f }); await saveSection("modules", copy); },
      i >= 0 ? async () => { const copy = mods.slice(); copy.splice(i, 1); await saveSection("modules", copy, "Eliminato"); } : null);
  };
  $("#add").onclick = () => edit(-1);
  bindList($("#adm"), mods, "modules", edit);
  $("#adm").querySelectorAll("[data-bulk]").forEach((b) => (b.onclick = () => bulkLessons(Number(b.dataset.bulk))));
  $("#adm").querySelectorAll("[data-les]").forEach((b) => (b.onclick = () => {
    const [i, j] = b.dataset.les.split(".").map(Number), m = mods[i];
    const l = j >= 0 ? m.lessons[j] : { title: "", youtubeId: "", video: "", minutes: "", desc: "", pdf: "" };
    const withLessons = (lessons) => mods.map((x, k) => (k === i ? { ...x, lessons } : x));
    formSheet(j >= 0 ? "Modifica lezione" : "Nuova lezione",
      field("Titolo", "title", l.title, "text", "required") +
      field("Video (link Loom, YouTube, Vimeo o Google Drive)", "video", lessonVideo(l), "text", 'placeholder="https://www.loom.com/share/…"') +
      `<p class="small muted" id="vkind" style="margin:-6px 0 12px"></p>` +
      field("Durata (minuti)", "minutes", l.minutes, "number", 'min="0"') +
      field("Descrizione", "desc", l.desc, "textarea") +
      field("Link PDF (facoltativo)", "pdf", l.pdf, "text", 'placeholder="/assets/pdf/… oppure https://"') +
      field("Quiz (facoltativo): una domanda per riga, la prima risposta è quella giusta", "quiz", (l.quiz || []).map((q) => [q.q, ...q.opts].join(" | ")).join("\n"), "textarea", 'rows="4" placeholder="Qual è il primo obiettivo della chiamata? | Fissare un appuntamento | Dire il prezzo | Parlare della provvigione"') +
      (j > 0 ? `<button type="button" class="btn sec block" id="lup" style="margin-bottom:8px">${icon("up", "sm")}Sposta su</button>` : ""),
      async (f) => {
        if (f.video && !videoSrc(f.video)) throw new Error("Link video non riconosciuto: usa un link Loom, YouTube, Vimeo o Google Drive");
        const quiz = f.quiz.split("\n").map((r) => r.split("|").map((x) => x.trim()).filter(Boolean)).filter((r) => r.length);
        const badQ = quiz.findIndex((r) => r.length < 3);
        if (badQ >= 0) throw new Error(`Quiz, riga ${badQ + 1}: servono la domanda e almeno due risposte, separate da |`);
        const ls = m.lessons.slice(), item = { ...l, ...f, quiz: quiz.map(([q, ...opts]) => ({ q, opts })), video: f.video.trim(), youtubeId: ytId(f.video), minutes: Number(f.minutes) || 0 };
        if (j >= 0) ls[j] = item; else ls.push(item);
        await saveSection("modules", withLessons(ls));
      },
      j >= 0 ? async () => { const ls = m.lessons.slice(); ls.splice(j, 1); await saveSection("modules", withLessons(ls), "Lezione eliminata"); } : null);
    const vin = $("#sf [name=video]"), vk = $("#vkind");
    const showKind = () => { const v = videoSrc(vin.value); vk.textContent = vin.value.trim() ? (v ? `✓ Video ${v.kind} riconosciuto` : "Link non riconosciuto") : ""; vk.style.color = v ? "#15803d" : "var(--warn)"; };
    vin.oninput = showKind; showKind();
    const up = $("#lup");
    if (up) up.onclick = () => { const ls = m.lessons.slice(); [ls[j - 1], ls[j]] = [ls[j], ls[j - 1]]; saveSection("modules", withLessons(ls), "Ordine aggiornato").catch((e) => toast(e.message)); };
  }));
}

// Scelta di cosa sblocca (per un utente o per un prodotto)
function accessPicker(selected) {
  const sel = new Set(selected || []);
  const box = (v, label, cls = "") => `<label class="acc-opt ${cls}"><input type="checkbox" name="acc" value="${esc(v)}" ${sel.has(v) ? "checked" : ""}><span>${label}</span></label>`;
  return `<div class="acc-pick">
    ${box("all", "<b>Tutto</b> (tutti i corsi e la community)", "all")}
    <div class="acc-grp">Sezioni</div>${box("community", "Community")}
    <div class="acc-grp">Accademie intere</div>${S.content.academies.map((a) => box(`acad:${a.id}`, esc(a.name))).join("")}
    <details><summary>Corsi singoli</summary>${S.content.academies.map((a) => { const ms = S.content.modules.filter((m) => m.academyId === a.id); return ms.length ? `<div class="acc-grp">${esc(a.name)}</div>${ms.map((m) => box(`course:${m.id}`, esc(m.title))).join("")}` : ""; }).join("")}</details>
  </div>`;
}
const pickedAccess = (root) => [...root.querySelectorAll("input[name=acc]:checked")].map((i) => i.value);
function accessSummary(acc) {
  if (acc === null || acc === undefined) return "Vede tutto (iscritto prima dei blocchi)";
  if (acc.includes("all")) return "Accesso completo";
  if (!acc.length) return "Tutto bloccato";
  const n = (pre) => acc.filter((x) => x.startsWith(pre)).length;
  return [n("acad:") && `${n("acad:")} accademie`, n("course:") && `${n("course:")} corsi`, acc.includes("community") && "community"].filter(Boolean).join(" · ");
}

function admProducts() {
  const ps = S.content.products || [];
  $("#adm").innerHTML = `<div class="card pad" style="margin-bottom:12px"><b>Come funziona</b><p class="small muted" style="margin-top:6px;line-height:1.5">1. Su Stripe crei un <b>Payment Link</b> per ogni prodotto e incolli qui il link.<br>2. Scegli cosa sblocca.<br>3. Chi paga viene sbloccato da solo e la vendita compare in Vendite.</p></div>
    <button class="btn pri block" id="add">${icon("plus", "sm")}Nuovo prodotto</button>
    <div class="card" style="margin-top:14px">${ps.map((p, i) => `<div class="adm-item"><span class="ini" style="width:36px;height:36px;border-radius:10px">${icon("euro", "sm")}</span><div class="grow"><h4>${esc(p.name)} ${p.price ? `· ${esc(p.price)}` : ""}</h4><p>${esc(accessSummary(p.grants))}${p.link ? "" : ' · <span style="color:var(--warn)">manca link Stripe</span>'}</p></div>${itemActs(i, ps.length)}</div>`).join("") || `<div class="empty">Nessun prodotto: creane uno.</div>`}</div>`;
  const edit = (i) => {
    const p = i >= 0 ? ps[i] : { name: "", desc: "", price: "", link: "", grants: [] };
    formSheet(i >= 0 ? "Modifica prodotto" : "Nuovo prodotto",
      field("Nome", "name", p.name, "text", 'required placeholder="Es. Accademia Agenti immobiliari"') +
      `<div class="two">${field("Prezzo (come lo vedono)", "price", p.price, "text", 'placeholder="Es. 997 €"')}<span></span></div>` +
      field("Descrizione breve", "desc", p.desc, "textarea") +
      field("Link di pagamento Stripe", "link", p.link, "text", 'placeholder="https://buy.stripe.com/…" inputmode="url" autocapitalize="off"') +
      `<div class="field"><span>Cosa sblocca</span>${accessPicker(p.grants)}</div>`,
      async (f, form) => {
        if (f.link && !/^https:\/\/\S+$/.test(f.link)) throw new Error("Il link Stripe deve iniziare con https://");
        const item = { ...p, name: f.name, price: f.price, desc: f.desc, link: f.link, grants: pickedAccess(form) };
        if (!item.grants.length) throw new Error("Scegli almeno una cosa da sbloccare");
        const copy = ps.slice(); if (i >= 0) copy[i] = item; else copy.push(item);
        await saveSection("products", copy);
      },
      i >= 0 ? async () => { const copy = ps.slice(); copy.splice(i, 1); await saveSection("products", copy, "Prodotto eliminato"); } : null);
  };
  $("#add").onclick = () => edit(-1);
  bindList($("#adm"), ps, "products", edit);
}

async function admSales() {
  $("#adm").innerHTML = `<div class="loading" style="min-height:100px"><div class="spin"></div></div>`;
  let sales = [], users = [];
  try { [sales, users] = await Promise.all([api("/admin/sales").then((d) => d.sales), api("/admin/users").then((d) => d.users)]); } catch (e) { $("#adm").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  sales.sort((a, b) => b.at - a.at);
  const tot = sales.reduce((n, x) => n + x.amount, 0);
  $("#adm").innerHTML = `
    <div class="qs" style="grid-template-columns:1fr 1fr"><div class="card q"><b>${money(tot)}</b><span>Totale venduto</span></div><div class="card q"><b>${sales.length}</b><span>Vendite</span></div></div>
    <div class="btns"><button class="btn pri" id="addSale">${icon("plus", "sm")}Vendita manuale</button><button class="btn sec" id="csv">${icon("doc", "sm")}Scarica Excel (CSV)</button></div>
    ${!sales.length ? `<div class="card empty">${icon("euro")}Nessuna vendita ancora.</div>` : ""}
    ${sales.length ? `<h2 class="sec">Tutte le vendite</h2><div class="card">${sales.map((x) => `<div class="adm-item"><div class="grow"><h4>${esc(x.productName || "Acquisto")} · ${money(x.amount, x.currency)}</h4><p>${esc(x.buyerName || x.buyerEmail || "Cliente")} · ${new Date(x.at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${x.source === "stripe" ? "Stripe" : "manuale"}${x.referrerName ? ` · link di ${esc(x.referrerName)}` : ""}</p></div><div class="acts"><button data-sdel="${esc(x.key)}" aria-label="Elimina">${icon("trash")}</button></div></div>`).join("")}</div>` : ""}`;
  $("#csv").onclick = () => {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Data", "Prodotto", "Importo", "Valuta", "Cliente", "Email cliente", "Fonte"].map(q).join(";"),
      ...sales.map((x) => [new Date(x.at).toLocaleString("it-IT"), x.productName, (x.amount / 100).toFixed(2).replace(".", ","), x.currency.toUpperCase(), x.buyerName, x.buyerEmail, x.source].map(q).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `vendite-vendita-uno-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  $("#addSale").onclick = () => {
    const ps = S.content.products || [];
    if (!ps.length) { toast("Prima crea un prodotto nella scheda Prodotti"); return; }
    formSheet("Vendita manuale",
      `<p class="small muted" style="margin-bottom:10px">Per bonifici o pagamenti fuori da Stripe: la persona viene sbloccata e la vendita finisce nel registro.</p>` +
      select("Chi ha acquistato", "buyerId", users.map((u) => [u.id, `${u.name} · ${u.email}`]), "") +
      select("Prodotto", "productId", ps.map((p) => [p.id, `${p.name}${p.price ? " · " + p.price : ""}`]), ps[0].id) +
      field("Importo pagato (€)", "amount", "", "text", 'required inputmode="decimal" placeholder="997"'),
      async (f) => {
        if (!(Number(String(f.amount).replace(",", ".")) > 0)) throw new Error("Scrivi l'importo pagato");
        await api("/admin/sales", f); closeSheet(); toast("Vendita registrata"); admSales();
      });
  };
  $("#adm").querySelectorAll("[data-sdel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Eliminare questa vendita dal registro? (Gli accessi già sbloccati restano)")) return;
    try { await api(`/admin/sales/${b.dataset.sdel}/delete`, {}); toast("Vendita eliminata"); admSales(); } catch (e) { toast(e.message); }
  }));
}

// Tante lezioni in una volta: una riga per lezione, "Titolo | link video".
function bulkLessons(i) {
  const mods = S.content.modules, m = mods[i];
  formSheet(`Aggiungi lezioni a "${m.title}"`,
    `<p class="small muted" style="margin-bottom:10px">Una lezione per riga: <b>Titolo | link del video</b>. Il link può essere Loom, YouTube, Vimeo o Google Drive. Se manca il link, la lezione resta "Video in arrivo".</p>` +
    field("Lezioni", "lines", "", "textarea", 'rows="8" placeholder="Come presentarsi al telefono | https://www.loom.com/share/…\nGestire le obiezioni | https://www.loom.com/share/…"'),
    async (f) => {
      const rows = f.lines.split("\n").map((r) => r.trim()).filter(Boolean);
      if (!rows.length) throw new Error("Scrivi almeno una lezione");
      const bad = [];
      const added = rows.map((r, k) => {
        const [title, link = ""] = r.split("|").map((x) => x.trim());
        if (link && !videoSrc(link)) bad.push(k + 1);
        return { title: title || `Lezione ${m.lessons.length + k + 1}`, video: link, youtubeId: ytId(link), minutes: 0, desc: "", pdf: "" };
      });
      if (bad.length) throw new Error(`Link non riconosciuto alla riga ${bad.join(", ")}`);
      await saveSection("modules", mods.map((x, k) => (k === i ? { ...x, lessons: [...x.lessons, ...added] } : x)), `${added.length} lezioni aggiunte`);
    });
}

function admOverview() {
  const c = S.content, lessons = c.modules.reduce((n, m) => n + m.lessons.length, 0);
  const noVideo = c.modules.reduce((n, m) => n + m.lessons.filter((l) => !lessonVideo(l)).length, 0);
  const quiz = c.modules.reduce((n, m) => n + m.lessons.filter((l) => (l.quiz || []).length).length, 0);
  $("#adm").innerHTML = `
    <div class="qs" style="grid-template-columns:repeat(2,1fr)">
      <div class="card q"><b>${c.modules.length}</b><span>Corsi</span></div>
      <div class="card q"><b>${lessons}</b><span>Lezioni${noVideo ? ` · ${noVideo} senza video` : ""}</span></div>
      <div class="card q"><b>${quiz}</b><span>Lezioni con quiz</span></div>
      <div class="card q" id="ucount"><b>…</b><span>Utenti</span></div>
    </div>
    <h2 class="sec">Azioni rapide</h2>
    <div class="grid" style="margin-top:0">
      <button class="acad" data-q="course" style="--c:#2f6bff"><span class="ic">${icon("cap")}</span><h4>Nuovo corso</h4><div class="ct">Poi aggiungi le lezioni</div></button>
      <button class="acad" data-q="lessons" style="--c:#7c3aed"><span class="ic">${icon("play")}</span><h4>Carica lezioni e quiz</h4><div class="ct">Link Loom, YouTube…</div></button>
      <button class="acad" data-q="users" style="--c:#0f9d58"><span class="ic">${icon("users")}</span><h4>Utenti e accessi</h4><div class="ct">Chi vede cosa</div></button>
      <button class="acad" data-q="notify" style="--c:#ea580c"><span class="ic">${icon("bell")}</span><h4>Avviso a tutti</h4><div class="ct">Notifica a ogni utente</div></button>
    </div>`;
  const go = (tab, after) => { adminTab = tab; viewAdmin(); if (after) after(); };
  $("#adm").querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => ({
    course: () => go("accademia", () => $("#add").click()),
    lessons: () => go("accademia", () => toast("Scegli il corso e premi \"Aggiungi più lezioni\"; il quiz si scrive dentro ogni lezione")),
    users: () => go("utenti"),
    notify: () => formSheet("Avviso a tutti",
      `<p class="small muted" style="margin-bottom:10px">Arriva nelle notifiche di ogni utente (campanella in alto).</p>` +
      field("Titolo", "title", "", "text", 'required maxlength="120"') + field("Testo", "text", "", "textarea", 'maxlength="300"') +
      select("Quando lo toccano, apre", "link", [["#/home", "Home"], ["#/accademia", "Accademia"], ["#/allenati", "Allenati"], ["#/progressi", "Progressi"], ["#/community", "Community"]], "#/home"),
      async (f) => { await api("/admin/notify", f); closeSheet(); toast("Avviso inviato a tutti"); refreshNotifs(); }),
  })[b.dataset.q]()));
  api("/admin/users").then((d) => { const el = $("#ucount b"); if (el) el.textContent = d.users.length; }).catch(() => {});
}

function admEducators() {
  const eds = S.content.educators;
  $("#adm").innerHTML = `<button class="btn pri block" id="add">${icon("plus", "sm")}Nuovo educatore</button>
    <div class="card" style="margin-top:14px">${eds.map((e, i) => `<div class="adm-item">${face(e.name, e.photo)}<div class="grow"><h4>${esc(e.name)}</h4><p>${esc((academyById(e.academyId) || {}).name || "—")}</p><p>${e.email ? `<span style="color:#15803d">✓ Account collegato: ${esc(e.email)}</span>` : `<span style="color:var(--warn)">Nessun account collegato: premi ✏️ e scegli chi è</span>`}</p></div>${itemActs(i, eds.length)}</div>`).join("") || `<div class="empty">Nessun educatore</div>`}</div>`;
  $("#adm").querySelectorAll(".adm-item .av,.adm-item .ini").forEach((x) => (x.style.cssText = "width:40px;height:40px;font-size:13px"));
  const edit = async (i) => {
    const e = i >= 0 ? eds[i] : { name: "", academyId: (S.content.academies[0] || {}).id, role: "", bio: "", photo: "", email: "" };
    // Elenco degli iscritti per collegare l'account dell'educatore senza scrivere l'email
    let users = [];
    try { users = (await api("/admin/users")).users; } catch {}
    const taken = new Set(eds.filter((x) => x !== e && x.email).map((x) => x.email));
    const opts = [["", "Nessuno (solo profilo)"], ...users.filter((u) => !taken.has(u.email)).map((u) => [u.email, `${u.name} · ${u.email}`])];
    if (e.email && !opts.some((o) => o[0] === e.email)) opts.push([e.email, e.email]);
    formSheet(i >= 0 ? "Modifica educatore" : "Nuovo educatore",
      select("Chi è? (scegli tra gli iscritti)", "email", opts, e.email) +
      `<p class="small muted" style="margin:-4px 0 12px">L'educatore compare sui corsi che tiene. Se non è ancora iscritto all'app, fallo registrare e poi torna qui.</p>` +
      field("Nome e cognome", "name", e.name, "text", "required") +
      select("Accademia", "academyId", S.content.academies.map((a) => [a.id, a.name]), e.academyId) +
      field("Specialità", "role", e.role, "text", 'placeholder="Es. Acquisizione in esclusiva"') +
      field("Bio", "bio", e.bio, "textarea") +
      imgField("Foto", "photo", e.photo),
      async (f) => { const copy = eds.slice(); if (i >= 0) copy[i] = { ...e, ...f }; else copy.push({ ...e, ...f }); await saveSection("educators", copy); },
      i >= 0 ? async () => {
        const copy = eds.slice(); copy.splice(i, 1); await saveSection("educators", copy, "Eliminato");
      } : null);
  };
  $("#add").onclick = () => edit(-1);
  bindList($("#adm"), eds, "educators", edit);
}
// Scegliendo la persona, il nome si compila da solo.
document.addEventListener("change", (ev) => {
  if (ev.target.matches("#sf select[name=email]")) {
    const nm = $("#sf [name=name]"), opt = ev.target.selectedOptions[0];
    if (nm && opt && ev.target.value && !nm.value) nm.value = opt.textContent.split(" · ")[0];
  }
});

function admAcademies() {
  const acs = S.content.academies;
  $("#adm").innerHTML = `<button class="btn pri block" id="add">${icon("plus", "sm")}Nuova accademia</button>
    <div class="card" style="margin-top:14px">${acs.map((a, i) => `<div class="adm-item"><span class="acad" style="padding:0;border:0;background:none;--c:${accColor(a)}"><span class="ic">${icon(a.icon)}</span></span><div class="grow"><h4>${esc(a.name)}</h4><p>${(a.subs || []).map((x) => esc(x.name)).join(" · ") || "Nessuna sottocategoria"}</p></div>${itemActs(i, acs.length)}</div>`).join("")}</div>`;
  const edit = (i) => {
    const a = i >= 0 ? acs[i] : { name: "", icon: "cap", color: "#2f6bff", cover: "" };
    formSheet(i >= 0 ? "Modifica accademia" : "Nuova accademia", field("Nome", "name", a.name, "text", "required") +
      `<div class="two">${select("Icona", "icon", ICONS.map((x) => [x, x]), a.icon)}${select("Colore", "color", COLORS, a.color)}</div>` +
      imgField("Card completa con nome e icona già dentro (900 × 1020 px)", "card", a.card, true) +
      `<p class="small muted" style="margin:-4px 0 12px">Se c'è la card completa, la foto del riquadro qui sotto non serve.</p>` +
      imgField("Foto del riquadro (900 × 1020 px)", "cover", a.cover, true) +
      imgField("Foto della testata (1600 × 700 px)", "hero", a.hero, true) +
      field("Sottocategorie (una per riga)", "subsText", (a.subs || []).map((x) => x.name).join("\n"), "textarea", 'rows="5" placeholder="Acquisizione\nTrattativa\nChiusura"'),
      async (f) => {
        // Tiene lo stesso codice per le sottocategorie con lo stesso nome, così i corsi restano collegati.
        const old = a.subs || [];
        const subs = f.subsText.split("\n").map((x) => x.trim()).filter(Boolean).map((name) => old.find((o) => o.name.toLowerCase() === name.toLowerCase()) || { id: name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) + "-" + Math.random().toString(16).slice(2, 6), name, icon: "cap" });
        delete f.subsText;
        const item = { ...a, ...f, subs };
        const copy = acs.slice(); if (i >= 0) copy[i] = item; else copy.push(item);
        await saveSection("academies", copy);
      },
      i >= 0 ? async () => { const copy = acs.slice(); copy.splice(i, 1); await saveSection("academies", copy, "Eliminato"); } : null);
  };
  $("#add").onclick = () => edit(-1);
  bindList($("#adm"), acs, "academies", edit);
}

async function admUsers() {
  $("#adm").innerHTML = `<div class="loading" style="min-height:100px"><div class="spin"></div></div>`;
  try {
    const { users, content } = await api("/admin/users");
    if (content) { S.content = content; toast("Creati i profili educatore mancanti"); }
    const draw = (t = "") => {
      const list = users.filter((u) => `${u.name} ${u.email} ${u.city}`.toLowerCase().includes(t.toLowerCase()));
      $("#ulist").innerHTML = list.map((u) => `<div class="adm-item"><div class="grow"><h4>${esc(u.name)}</h4><p>${esc(u.email)}${u.city ? " · " + esc(u.city) : ""}</p>${u.educatorId ? `<p><a href="#/educatore/${esc(u.educatorId)}" style="color:var(--blue-2);font-weight:600">Profilo educatore collegato ›</a></p>` : u.role === "educator" ? `<p><button data-mkedu="${esc(u.id)}" style="color:var(--warn);font-weight:700">Crea profilo educatore ›</button></p>` : ""}${u.role === "agent" ? `<p class="row" style="gap:8px;margin-top:4px"><span class="ell" style="color:${u.access && !u.access.length ? "var(--warn)" : "#15803d"}">${icon("key", "sm")} ${esc(accessSummary(u.access))}</span><button data-acc="${esc(u.id)}" style="color:var(--blue-2);font-weight:700;flex:none">Accessi</button></p>` : ""}</div>
        <select data-role="${esc(u.id)}">${[["agent", "Agente"], ["educator", "Educatore"], ["admin", "Admin"]].map(([v, n]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>`).join("") || `<div class="empty">Nessun utente</div>`;
      $("#ulist").querySelectorAll("[data-acc]").forEach((b) => (b.onclick = () => {
        const u = users.find((x) => x.id === b.dataset.acc);
        formSheet(`Cosa può vedere ${u.name}`,
          (u.access === null ? `<p class="small" style="margin-bottom:10px;color:var(--warn)">Si è iscritto prima dei blocchi e ora vede tutto. Salvando, vedrà solo quello che spunti.</p>` : "") +
          accessPicker(u.access === null ? ["all"] : u.access),
          async (f, form) => { const d = await api("/admin/access", { id: u.id, access: pickedAccess(form) }); u.access = d.access; closeSheet(); toast("Accessi aggiornati"); draw($("#uq").value); });
      }));
      $("#ulist").querySelectorAll("[data-mkedu]").forEach((b) => (b.onclick = () => {
        const sel = $(`#ulist [data-role="${b.dataset.mkedu}"]`);
        const u = users.find((x) => x.id === b.dataset.mkedu); u.role = "agent";
        sel.value = "educator"; sel.onchange();
      }));
      $("#ulist").querySelectorAll("[data-role]").forEach((s) => (s.onchange = async () => {
        const prev = (users.find((x) => x.id === s.dataset.role) || {}).role || "agent";
        if (prev === "educator" && s.value === "agent" && !confirm("Togliendolo dagli educatori si elimina anche il suo profilo educatore. Continuare?")) { s.value = prev; return; }
        let extra = {};
        if (s.value === "educator") {
          extra = await new Promise((ok) => {
            formSheet("Che educatore è?",
              select("Accademia", "academyId", S.content.academies.map((a) => [a.id, a.name]), (S.content.academies[0] || {}).id) +
              field("Specialità (facoltativa)", "specialty", "", "text", 'placeholder="Es. Acquisizione in esclusiva"'),
              async (f) => { closeSheet(); ok(f); });
            const close = () => setTimeout(() => { if (!$("#sheet").classList.contains("open")) ok(null); }, 300);
            $("#sheetClose").addEventListener("click", close, { once: true });
            $("#sheet").addEventListener("click", (ev) => { if (ev.target.id === "sheet") close(); }, { once: true });
          });
          if (!extra) { s.value = prev; return; }
        }
        try {
          const d = await api("/admin/role", { id: s.dataset.role, role: s.value, ...extra });
          if (d.content) S.content = d.content; else await loadMe();
          const u = users.find((x) => x.id === s.dataset.role);
          u.role = s.value;
          if (s.value === "educator") {
            u.educatorId = (S.content.educators.find((e) => e.email === u.email) || {}).id || "";
            toast("Ora è educatore: completa il suo profilo in Educatori");
          } else { if (s.value === "agent") u.educatorId = ""; toast(s.value === "agent" && prev === "educator" ? "Non è più educatore: tolto anche il suo profilo" : "Ruolo aggiornato"); }
          draw($("#uq").value);
        } catch (e) { toast(e.message); s.value = (users.find((x) => x.id === s.dataset.role) || {}).role || "agent"; }
      }));
    };
    $("#adm").innerHTML = `<div class="qs" style="grid-template-columns:1fr 1fr"><div class="card q"><b>${users.length}</b><span>Utenti</span></div><div class="card q"><b>${users.filter((u) => Date.now() - u.at < 7 * 86400000).length}</b><span>Ultimi 7 giorni</span></div></div>
      <label class="search" style="margin-top:12px">${icon("search")}<input id="uq" placeholder="Cerca per nome, email, città"></label>
      <div class="card" id="ulist" style="margin-top:12px"></div>`;
    $("#uq").oninput = (e) => draw(e.target.value);
    draw();
  } catch (e) { $("#adm").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

// =====================================================================
// ALLENATI: livelli, giorni di fila, simulatore di chiamate, risultati,
// classifica, muro dei successi, quiz e certificati.
// =====================================================================
const LEVELS = [
  [0, "Recluta"], [100, "Apprendista"], [300, "Agente"], [600, "Agente Pro"], [1000, "Negoziatore"],
  [1600, "Acquisitore"], [2500, "Top Agent"], [4000, "Fuoriclasse"], [6000, "Leggenda"], [9000, "Milionario"],
];
function levelOf(xp = 0) {
  let i = 0;
  while (i < LEVELS.length - 1 && xp >= LEVELS[i + 1][0]) i++;
  const min = LEVELS[i][0], next = LEVELS[i + 1] ? LEVELS[i + 1][0] : null;
  return { n: i + 1, name: LEVELS[i][1], min, next, pct: next ? Math.round(((xp - min) / (next - min)) * 100) : 100, nextName: LEVELS[i + 1] ? LEVELS[i + 1][1] : "" };
}
const gymNow = () => S.gym || { xp: 0, streak: 0, best: 0, today: false, days: [], quiz: {} };
// Badge del livello: un esagono con il numero, colore che si scalda salendo.
function lvlBadge(lv, size = 56) {
  const hue = [218, 218, 210, 200, 190, 160, 45, 35, 280, 50][lv.n - 1];
  return `<span class="lvb" style="--s:${size}px;--h:${hue}"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4 90 27v46L50 96 10 73V27z"/></svg><b>${lv.n}</b></span>`;
}
// Dopo ogni azione: aggiorna i punti, mostra quanti ne hai presi e festeggia il nuovo livello.
function gain(d) {
  if (!d || !d.gym) return;
  const before = levelOf(gymNow().xp).n;
  S.gym = d.gym;
  const lv = levelOf(S.gym.xp);
  if (lv.n > before) levelUp(lv);
  else if (d.gained) toast(`+${d.gained} punti${S.gym.streak > 1 ? ` · ${S.gym.streak} giorni di fila` : ""}`);
}
function levelUp(lv) {
  const el = document.createElement("div");
  el.className = "lvup";
  el.innerHTML = `<div class="lvup-in">${lvlBadge(lv, 120)}<p>Sei salito di livello</p><h2>${esc(lv.name)}</h2>${lv.next ? `<small>Prossimo: ${esc(lv.nextName)} a ${lv.next} punti</small>` : "<small>Hai raggiunto il livello più alto</small>"}<button class="btn white">Continua</button></div>`;
  document.body.appendChild(el);
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 300); };
  el.querySelector("button").onclick = close;
  el.onclick = (e) => { if (e.target === el) close(); };
}
function flame(on) {
  return `<svg class="fl ${on ? "on" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.7-2.6-5.9-4.3-8.9-.4 1.9-1.3 3-2.4 3.6C12.6 7 11.5 4 8.6 2c.3 3.3-1.6 5.3-2.9 7.3C4.6 11 4 12.6 4 15.4 4 19.1 7.6 22 12 22z"/></svg>`;
}

// Card "il tuo allenamento" in home
function gymCard() {
  const g = gymNow(), lv = levelOf(g.xp);
  return `<section class="gymcard">
    <a class="gc-top" href="#/progressi/classifica">
      ${lvlBadge(lv, 58)}
      <div class="grow"><h3>${esc(lv.name)}</h3>
        <div class="prog"><i style="width:${lv.pct}%"></i></div>
        <p>${lv.next ? `${g.xp} punti · ancora ${lv.next - g.xp} per ${esc(lv.nextName)}` : `${g.xp} punti`}</p></div>
      <div class="gc-streak ${g.today ? "on" : ""}">${flame(g.streak > 0)}<b>${g.streak}</b><small>${g.streak === 1 ? "giorno" : "giorni"}</small></div>
    </a>
    <a class="gc-call" href="#/allenati">
      <span class="ring">${icon("phone")}</span>
      <div class="grow"><h4>Allenati al telefono</h4><p>Un cliente vero ti risponde. Alla fine ricevi il voto.</p></div>${icon("chev")}
    </a>
    ${g.today ? "" : `<p class="gc-hint">${g.streak ? `Fai una lezione o una telefonata oggi per non perdere i tuoi ${g.streak} giorni di fila.` : "Fai una lezione o una telefonata oggi per iniziare la tua serie."}</p>`}
  </section>`;
}

// ---------- muro dei successi ----------
const WIN_LABEL = { incarico: "Incarico preso", vendita: "Vendita chiusa", appuntamento: "Appuntamento fissato", affitto: "Affitto chiuso", altro: "Successo" };
const WIN_ICON = { incarico: "key", vendita: "home2", appuntamento: "cal", affitto: "doc", altro: "spark" };
function winCard(w) {
  return `<article class="win" data-win="${esc(w.key)}">
    <div class="win-hd"><span class="win-ic">${icon(WIN_ICON[w.kind] || "spark")}</span><b>${esc(WIN_LABEL[w.kind] || "Successo")}</b><span class="muted small">${ago(w.at)}</span></div>
    <p>${esc(w.text)}</p>
    <div class="win-ft">${face(w.author, imgUrl(w.avatar))}<span class="grow ell">${esc(w.author)}${w.city ? `<small>${esc(w.city)}</small>` : ""}</span>
      <button class="clap ${w.clapped ? "on" : ""}" data-clap aria-label="Applaudi">👏 <span>${w.claps || ""}</span></button>
      ${w.mine || S.user.role === "admin" ? `<button class="wdel" data-wdel aria-label="Elimina">${icon("trash", "sm")}</button>` : ""}</div>
  </article>`;
}
function bindWins(root, onChange) {
  root.querySelectorAll("[data-win]").forEach((el) => {
    const key = el.dataset.win;
    const c = el.querySelector("[data-clap]");
    if (c) c.onclick = async () => {
      try { const { win } = await api(`/wins/${key}/clap`, {}); c.classList.toggle("on", win.clapped); c.querySelector("span").textContent = win.claps || ""; } catch (e) { toast(e.message); }
    };
    const d = el.querySelector("[data-wdel]");
    if (d) d.onclick = async () => {
      if (!confirm("Eliminare questo successo?")) return;
      try { await api(`/wins/${key}/delete`, {}); el.remove(); if (onChange) onChange(); } catch (e) { toast(e.message); }
    };
  });
}
async function paintHomeWins() {
  const box = $("#homeWins");
  if (!box) return;
  try {
    const { wins } = await api("/wins");
    if (!document.body.contains(box)) return;
    box.innerHTML = wins.length ? `${secHd("Muro dei successi", null, `<a href="#/progressi/successi">Tutti</a>`)}<div class="wins-row">${wins.slice(0, 8).map(winCard).join("")}</div>` : "";
    bindWins(box);
  } catch {}
}
function shareWin(onDone) {
  let kind = "incarico";
  openSheet("Condividi un successo", `
    <div class="kinds">${Object.keys(WIN_LABEL).map((k) => `<button type="button" data-k="${k}" class="${k === kind ? "on" : ""}">${icon(WIN_ICON[k], "sm")}${WIN_LABEL[k]}</button>`).join("")}</div>
    <form id="wf">${field("Cosa hai ottenuto?", "text", "", "textarea", 'maxlength="280" required placeholder="Es. Primo incarico in esclusiva dopo 3 settimane di chiamate. Il metodo funziona!"')}
    <div id="werr"></div><button class="btn pri block">${icon("spark", "sm")}Pubblica sul muro</button></form>
    <p class="small muted" style="text-align:center;margin-top:10px">Lo vedono tutti gli iscritti. +${25} punti una volta al giorno.</p>`, (root) => {
    root.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { kind = b.dataset.k; root.querySelectorAll("[data-k]").forEach((x) => x.classList.toggle("on", x === b)); }));
    root.querySelector("#wf").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button"); btn.disabled = true;
      try { const d = await api("/wins", { kind, text: e.target.text.value }); closeSheet(); gain(d); if (onDone) onDone(); }
      catch (err) { $("#werr").innerHTML = `<div class="err">${esc(err.message)}</div>`; btn.disabled = false; }
    };
  });
}

// ---------- pagina Allenati ----------
let gymData = null;
async function loadGym() {
  const d = await api("/gym");
  gymData = d; S.gym = d.gym;
  return d;
}
const GYM_TABS = [["risultati", "Risultati"], ["classifica", "Classifica"], ["successi", "Successi"]];
async function viewGym([tab = ""]) {
  const g = gymNow(), lv = levelOf(g.xp);
  view.innerHTML = `
    <header class="stage">
      ${tab ? `<div class="st-row">
        <div class="grow"><p class="st-k">Livello ${lv.n} · ${g.xp} punti</p><h1>${esc(lv.name)}</h1>
          <div class="prog"><i style="width:${lv.pct}%"></i></div>
          <p class="st-sub">${lv.next ? `Ancora ${lv.next - g.xp} punti per diventare ${esc(lv.nextName)}` : "Hai raggiunto il livello più alto"}</p></div>
        ${lvlBadge(lv, 76)}
      </div>
      <div class="st-chips"><span class="st-chip ${g.streak ? "hot" : ""}">${flame(g.streak > 0)}<span><b>${g.streak} ${g.streak === 1 ? "giorno" : "giorni"}</b>di fila</span></span><span class="st-chip">${icon("trend", "sm")}<span><b>${g.best}</b>record</span></span></div>`
      : `<div class="st-row"><div class="grow"><p class="st-k">${g.simToday ? `${g.simToday} ${g.simToday === 1 ? "telefonata" : "telefonate"} oggi` : "Nessuna telefonata oggi"}</p><h1>Allenati al telefono</h1><p class="st-sub">Scegli un cliente e chiamalo. Risponde come una persona vera, poi il coach ti dà il voto.</p></div><span class="st-phone">${icon("phone")}</span></div>`}
    </header>
    <div class="body">
    ${tab ? `<div class="utabs">${GYM_TABS.map(([k, n]) => `<a href="#/progressi/${k}" class="${tab === k ? "on" : ""}">${n}</a>`).join("")}</div>` : ""}
    <div id="gymBody"><div class="loading"><div class="spin"></div></div></div></div>`;
  try { if (!gymData || tab === "" || tab === "risultati") await loadGym(); } catch (e) { $("#gymBody").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const body = $("#gymBody");
  if (!body) return;
  if (tab === "risultati") return gymResults(body);
  if (tab === "classifica") return gymBoard(body);
  if (tab === "successi") return gymWins(body);
  gymCalls(body);
}

let simFilter = "";
function gymCalls(body) {
  const d = gymData, best = {};
  for (const s of d.sims || []) best[s.id] = Math.max(best[s.id] || 0, s.voto);
  const accs = [...new Set(d.scenarios.map((s) => s.academy))].map(academyById).filter(Boolean);
  const list = d.scenarios.filter((s) => !simFilter || s.academy === simFilter);
  const lvlName = ["", "Facile", "Media", "Difficile"];
  body.innerHTML = `
    ${d.simReady ? "" : `<div class="card pad warnbox">${icon("lock")}<div><b>Il simulatore si sta accendendo</b><p class="small muted">${S.user.role === "admin" ? "Per attivarlo aggiungi la chiave ANTHROPIC_API_KEY nelle variabili segrete del Worker su Cloudflare." : "Sarà disponibile a breve. Intanto puoi segnare i tuoi risultati e scalare la classifica."}</p></div></div>`}
    <div class="fchips"><button data-sf="" class="${!simFilter ? "on" : ""}">Tutti</button>${accs.map((a) => `<button data-sf="${esc(a.id)}" class="${simFilter === a.id ? "on" : ""}" style="--c:${accColor(a)}"><i></i>${esc(a.name)}</button>`).join("")}</div>
    <div class="scen-list">${list.map((s) => {
      const a = academyById(s.academy);
      return `<a class="scen" href="#/sim/${esc(s.id)}" style="--c:${accColor(a)}">
        <span class="scen-av">${initials(s.who)}</span>
        <div class="grow"><h3>${esc(s.title)}</h3><p>${esc(s.who)}, ${esc(s.role.charAt(0).toLowerCase() + s.role.slice(1))}</p>
          <div class="scen-goal">${icon("check", "sm")}${esc(s.goal)}</div></div>
        <div class="scen-side"><span class="diff d${s.level}" title="${lvlName[s.level]}"><i></i><i></i><i></i></span>${best[s.id] != null ? `<span class="best">${best[s.id]}</span>` : `<span class="callbtn">${icon("phone", "sm")}</span>`}</div>
      </a>`;
    }).join("")}</div>`;
  body.querySelectorAll("[data-sf]").forEach((b) => (b.onclick = () => { simFilter = b.dataset.sf; gymCalls(body); }));
}

// Risultati: cosa hai fatto sul campo, settimana per settimana.
const RES_F = [["c", "Chiamate", "phone"], ["a", "Appuntamenti", "cal"], ["m", "Incarichi", "key"], ["s", "Vendite", "home2"]];
function addDays(key, n) { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const todayKey = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
function mondayOf(key) { const d = new Date(`${key}T12:00:00Z`); return addDays(key, -((d.getUTCDay() + 6) % 7)); }
function sumRange(res, from, days) {
  const t = { c: 0, a: 0, m: 0, s: 0 };
  for (let i = 0; i < days; i++) { const r = res[addDays(from, i)]; if (r) for (const k in t) t[k] += r[k] || 0; }
  return t;
}
function gymResults(body) {
  const res = gymData.results || {}, today = todayKey(), mon = mondayOf(today);
  const wk = sumRange(res, mon, 7), prev = sumRange(res, addDays(mon, -7), 7);
  const weeks = [...Array(8)].map((_, i) => { const from = addDays(mon, -7 * (7 - i)); return { from, t: sumRange(res, from, 7) }; });
  const maxC = Math.max(1, ...weeks.map((w) => w.t.c));
  const all = sumRange(res, addDays(today, -89), 90);
  const rate = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  let day = today;
  const cur = () => res[day] || { c: 0, a: 0, m: 0, s: 0 };
  const certs = Object.entries(gymData.certs || {}).map(([mid, code]) => ({ m: courseById(mid), code })).filter((x) => x.m);
  body.innerHTML = `
    <section class="card pad logday">
      <div class="row" style="justify-content:space-between"><h2 class="h2s">Segna la giornata</h2>
        <div class="seg mini"><button data-day="${today}" class="on">Oggi</button><button data-day="${addDays(today, -1)}">Ieri</button></div></div>
      <div class="steps" id="steps"></div>
      <button class="btn pri block" id="saveRes">${icon("check", "sm")}Salva la giornata</button>
      <p class="small muted" style="text-align:center;margin-top:8px">+10 punti al giorno. I numeri li vedi solo tu.</p>
    </section>
    <h2 class="sec">Questa settimana</h2>
    <div class="kpis">${RES_F.map(([k, n, ic]) => { const diff = wk[k] - prev[k]; return `<div class="kpi">${icon(ic, "sm")}<b>${wk[k]}</b><span>${n}</span><small class="${diff > 0 ? "up" : diff < 0 ? "dn" : ""}">${diff > 0 ? "+" + diff : diff < 0 ? diff : "="} rispetto alla scorsa</small></div>`; }).join("")}</div>
    <h2 class="sec">Chiamate nelle ultime 8 settimane</h2>
    <div class="card pad bars" role="img" aria-label="Chiamate per settimana">${weeks.map((w, i) => `<div class="bar ${i === 7 ? "now" : ""}"><span class="v">${w.t.c || ""}</span><i style="height:${Math.round((w.t.c / maxC) * 100)}%"></i><small>${new Date(`${w.from}T12:00:00Z`).getUTCDate()}/${new Date(`${w.from}T12:00:00Z`).getUTCMonth() + 1}</small></div>`).join("")}</div>
    <h2 class="sec">Il tuo imbuto · ultimi 90 giorni</h2>
    <div class="card pad funnel">
      ${[["Chiamate", all.c, 100], ["Appuntamenti", all.a, rate(all.a, all.c)], ["Incarichi", all.m, rate(all.m, all.a)], ["Vendite", all.s, rate(all.s, all.m)]].map(([n, v, r], i) => `<div class="fn" style="--w:${Math.max(18, 100 - i * 22)}%"><div class="fn-bar"><b>${v}</b><span>${n}</span></div>${i ? `<small>${r}% del passo prima</small>` : ""}</div>`).join("")}
      ${all.c ? `<p class="small muted" style="margin-top:12px">${all.a ? `Ogni ${Math.round(all.c / all.a)} chiamate fissi un appuntamento.` : "Ancora nessun appuntamento: allenati al telefono per sbloccarlo."}${all.m ? ` Ogni ${Math.round(all.c / all.m)} chiamate prendi un incarico.` : ""}</p>` : `<p class="small muted" style="margin-top:12px">Segna le tue giornate: qui vedrai quante chiamate ti servono per un incarico.</p>`}
    </div>
    <h2 class="sec">Giorni attivi</h2>
    <div class="card pad heat">${[...Array(42)].map((_, i) => { const k = addDays(today, i - 41); return `<i class="${gymNow().days.includes(k) ? "on" : ""} ${k === today ? "td" : ""}" title="${k}"></i>`; }).join("")}</div>
    <p class="small muted" style="margin-top:8px">Record: ${gymNow().best} giorni di fila.</p>
    ${certs.length ? `<h2 class="sec">I tuoi certificati</h2><div class="card">${certs.map((c) => `<a class="les" href="#/corso/${esc(c.m.id)}"><span class="st done">${icon("doc", "sm")}</span><div class="grow"><h4>${esc(c.m.title)}</h4><p>Codice ${esc(c.code)}</p></div>${icon("chev", "sm")}</a>`).join("")}</div>` : ""}`;
  const paint = () => {
    const r = cur();
    $("#steps").innerHTML = RES_F.map(([k, n, ic]) => `<div class="step"><span class="st-ic">${icon(ic, "sm")}</span><span class="grow">${n}</span><button type="button" data-d="-1" data-f="${k}" aria-label="Meno ${n}">−</button><input inputmode="numeric" data-f="${k}" value="${r[k] || 0}" aria-label="${n}"><button type="button" data-d="1" data-f="${k}" aria-label="Più ${n}">+</button></div>`).join("");
    $("#steps").querySelectorAll("button[data-d]").forEach((b) => (b.onclick = () => { const inp = $(`#steps input[data-f=${b.dataset.f}]`); inp.value = Math.max(0, (Number(inp.value) || 0) + Number(b.dataset.d)); }));
  };
  paint();
  body.querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => { day = b.dataset.day; body.querySelectorAll("[data-day]").forEach((x) => x.classList.toggle("on", x === b)); paint(); }));
  $("#saveRes").onclick = async (e) => {
    const data = { date: day };
    $("#steps").querySelectorAll("input").forEach((i) => (data[i.dataset.f] = Number(i.value) || 0));
    e.target.disabled = true;
    try { const d = await api("/results", data); gymData.results = d.results; gain(d); if (!d.gained) toast("Giornata salvata"); gymResults(body); }
    catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

let boardWeek = "", boardCity = false;
async function gymBoard(body) {
  body.innerHTML = `<div class="loading"><div class="spin"></div></div>`;
  let d;
  try { d = await api(`/gym/board${boardWeek ? "?week=prev" : ""}`); } catch (e) { body.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const city = (S.user.city || "").trim().toLowerCase();
  const list = boardCity && city ? d.list.filter((x) => (x.city || "").trim().toLowerCase() === city) : d.list;
  const pod = list.slice(0, 3), rest = list.slice(3);
  const row = (x, i) => `<div class="lb-row ${x.me ? "me" : ""}"><span class="pos">${i + 1}</span>${face(x.name, imgUrl(x.avatar))}<div class="grow"><b>${esc(x.name)}${x.me ? " (tu)" : ""}</b><small>${esc(x.city || "")}</small></div><span class="pts">${x.xp}</span></div>`;
  body.innerHTML = `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div class="seg mini"><button data-w="" class="${!boardWeek ? "on" : ""}">Questa settimana</button><button data-w="prev" class="${boardWeek ? "on" : ""}">Scorsa</button></div>
      ${city ? `<div class="seg mini"><button data-c="0" class="${!boardCity ? "on" : ""}">Italia</button><button data-c="1" class="${boardCity ? "on" : ""}">${esc(S.user.city)}</button></div>` : ""}
    </div>
    ${!boardWeek && d.rank ? `<p class="lb-me">Sei <b>${d.rank}°</b> su ${d.total} questa settimana.</p>` : !boardWeek ? `<p class="lb-me">Non sei ancora in classifica: completa una lezione o fai una telefonata.</p>` : ""}
    ${pod.length ? `<div class="podium">${[1, 0, 2].filter((i) => pod[i]).map((i) => `<div class="pd p${i + 1} ${pod[i].me ? "me" : ""}">${face(pod[i].name, imgUrl(pod[i].avatar))}<b>${esc(pod[i].name.split(" ")[0])}</b><span>${pod[i].xp} pt</span><div class="blk">${i + 1}</div></div>`).join("")}</div>` : `<div class="card empty">${icon("trend")}Nessuno in classifica${boardCity ? " nella tua città" : ""}, per ora. Il primo posto è libero.</div>`}
    ${rest.length ? `<div class="card lb">${rest.map((x, i) => row(x, i + 3)).join("")}</div>` : ""}
    <p class="small muted" style="margin-top:14px;text-align:center">La classifica riparte ogni lunedì. Punti: lezione 20 · quiz superato 30 · telefonata fino a 40 · giornata segnata 10 · successo 25.</p>`;
  body.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => { boardWeek = b.dataset.w; gymBoard(body); }));
  body.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { boardCity = b.dataset.c === "1"; gymBoard(body); }));
}

async function gymWins(body) {
  body.innerHTML = `<button class="btn pri block" id="shareWin">${icon("spark", "sm")}Condividi un successo</button><div id="winList" class="wins-col"><div class="loading"><div class="spin"></div></div></div>`;
  $("#shareWin").onclick = () => shareWin(() => gymWins(body));
  try {
    const { wins } = await api("/wins");
    const box = $("#winList");
    box.innerHTML = wins.map(winCard).join("") || `<div class="card empty">${icon("spark")}Il muro è vuoto. Il tuo primo incarico, il primo appuntamento, la prima vendita: scrivilo qui.</div>`;
    bindWins(box);
  } catch (e) { $("#winList").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

// ---------- telefonata simulata ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let simVoice = (() => { try { return localStorage.getItem("vu_simvoice") !== "0"; } catch { return true; } })();
function speak(text) {
  if (!simVoice || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "it-IT"; u.rate = 1.04;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith("it"));
  if (v) u.voice = v;
  const av = $("#callAv");
  u.onstart = () => av && av.classList.add("talk");
  u.onend = () => av && av.classList.remove("talk");
  speechSynthesis.speak(u);
}
async function viewSim([id]) {
  if (!gymData) { try { await loadGym(); } catch (e) { toast(e.message); location.hash = "#/allenati"; return; } }
  const s = gymData.scenarios.find((x) => x.id === id);
  if (!s) { location.hash = "#/allenati"; return; }
  const a = academyById(s.academy);
  const msgs = []; // { role: "user" | "assistant", text }
  let busy = false, ended = false, t0 = Date.now(), timer, rec = null, recOn = false;
  view.innerHTML = `
    <div class="call" style="--c:${accColor(a)}">
      <div class="call-top"><a href="#/allenati" class="call-x" aria-label="Esci">${icon("back")}</a><span id="callTime">00:00</span><button id="voiceBtn" class="call-x ${simVoice ? "on" : ""}" aria-label="Voce del cliente">${icon("mega")}</button></div>
      <div class="call-who">
        <div class="call-av" id="callAv"><span>${initials(s.who)}</span></div>
        <h1>${esc(s.who)}</h1><p>${esc(s.role)}</p>
        <div class="call-goal">${icon("check", "sm")}<span>Obiettivo: ${esc(s.goal)}</span></div>
      </div>
      <div class="call-log" id="log" aria-live="polite"></div>
      <div class="call-bar">
        <form id="sayF" class="say"><input id="say" class="inp" placeholder="${SpeechRec ? "Parla o scrivi…" : "Scrivi cosa dici…"}" autocomplete="off" maxlength="700"><button class="send" aria-label="Invia">${icon("chev")}</button></form>
        <div class="call-btns">
          ${SpeechRec ? `<button id="micBtn" class="cb mic" aria-label="Microfono">${micSvg()}</button>` : ""}
          <button id="endBtn" class="cb end" aria-label="Chiudi la chiamata">${icon("phone")}</button>
        </div>
        <p class="call-tip" id="tip">${SpeechRec ? "Tocca il microfono, parla, poi toccalo di nuovo per inviare." : "Scrivi come parleresti al telefono."}</p>
      </div>
    </div>`;
  document.body.classList.add("incall");
  const log = $("#log");
  const add = (role, text, extra = "") => {
    const el = document.createElement("div");
    el.className = `bub ${role === "user" ? "me" : "them"} ${extra}`;
    el.textContent = text;
    log.appendChild(el); log.scrollTop = log.scrollHeight;
    return el;
  };
  add("assistant", s.opener);
  speak(s.opener);
  timer = setInterval(() => {
    if (!document.body.contains(log)) { clearInterval(timer); return; }
    const sec = Math.floor((Date.now() - t0) / 1000);
    $("#callTime").textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  }, 1000);
  $("#voiceBtn").onclick = (e) => {
    simVoice = !simVoice; try { localStorage.setItem("vu_simvoice", simVoice ? "1" : "0"); } catch {}
    e.currentTarget.classList.toggle("on", simVoice);
    if (!simVoice && window.speechSynthesis) speechSynthesis.cancel();
    toast(simVoice ? "Voce del cliente attiva" : "Voce del cliente spenta");
  };
  const send = async (text) => {
    text = text.trim();
    if (!text || busy || ended) return;
    busy = true;
    msgs.push({ role: "user", text });
    add("user", text);
    $("#say").value = "";
    const typing = add("assistant", "", "typing");
    typing.innerHTML = "<i></i><i></i><i></i>";
    try {
      const d = await api("/sim/turn", { scenario: s.id, history: msgs });
      typing.remove();
      msgs.push({ role: "assistant", text: d.text });
      add("assistant", d.text);
      speak(d.text);
      if (d.goal || d.hangup) {
        ended = true;
        add("system", d.goal ? "Obiettivo raggiunto. Chiudi per vedere il voto." : "Il cliente ha riattaccato.", d.goal ? "sys ok" : "sys");
        $("#endBtn").classList.add("pulse-end");
      }
    } catch (e) {
      typing.remove(); msgs.pop(); log.lastChild && log.lastChild.classList.add("fail");
      toast(e.message);
    }
    busy = false;
  };
  $("#sayF").onsubmit = (e) => { e.preventDefault(); send($("#say").value); };
  if (SpeechRec) {
    $("#micBtn").onclick = () => {
      if (recOn) { rec.stop(); return; }
      if (window.speechSynthesis) speechSynthesis.cancel();
      rec = new SpeechRec(); rec.lang = "it-IT"; rec.interimResults = true; rec.continuous = true;
      let final = "";
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) final += t + " "; else interim += t; }
        $("#say").value = (final + interim).trim();
      };
      rec.onerror = (ev) => { if (ev.error === "not-allowed") toast("Consenti il microfono nelle impostazioni del browser"); };
      rec.onend = () => { recOn = false; $("#micBtn").classList.remove("on"); $("#tip").textContent = "Tocca il microfono, parla, poi toccalo di nuovo per inviare."; send($("#say").value); };
      rec.start(); recOn = true;
      $("#micBtn").classList.add("on"); $("#tip").textContent = "Ti ascolto… tocca di nuovo per inviare.";
    };
  }
  $("#endBtn").onclick = async () => {
    if (recOn) { rec.onend = null; rec.stop(); recOn = false; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    clearInterval(timer);
    const said = msgs.filter((m) => m.role === "user").length;
    if (said < 2) { toast("Chiamata chiusa. Per il voto servono almeno due frasi."); location.hash = "#/allenati"; return; }
    view.querySelector(".call").innerHTML = `<div class="scoring"><div class="call-av talk"><span>${icon("brain")}</span></div><h2>Il coach riascolta la chiamata</h2><p>Ci vogliono pochi secondi.</p></div>`;
    try {
      const d = await api("/sim/score", { scenario: s.id, history: msgs });
      gymData.sims = [...(gymData.sims || []), { id: s.id, voto: d.score.voto, ok: d.score.obiettivo, at: Date.now() }];
      simReport(s, d.score, d.gained, Math.floor((Date.now() - t0) / 1000));
      gain(d);
    } catch (e) {
      view.querySelector(".call").innerHTML = `<div class="scoring"><h2>Valutazione non arrivata</h2><p>${esc(e.message)}</p><a class="btn white" href="#/allenati">Torna alle telefonate</a></div>`;
    }
  };
  $("#say").focus({ preventScroll: true });
}
function micSvg() { return `<svg class="i" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`; }
function simReport(s, r, gained, secs) {
  const col = r.voto >= 80 ? "#22c55e" : r.voto >= 60 ? "#5b8cff" : r.voto >= 40 ? "#f5b041" : "#ff5a5a";
  const C = 2 * Math.PI * 54;
  const verdict = r.voto >= 85 ? "Telefonata da manuale" : r.voto >= 70 ? "Buona telefonata" : r.voto >= 50 ? "Ci sei quasi" : "Da rifare";
  view.querySelector(".call").innerHTML = `
    <div class="report">
      <div class="call-top"><a href="#/allenati" class="call-x" aria-label="Esci">${icon("back")}</a><span>${esc(s.title)}</span><span class="call-x"></span></div>
      <div class="score" style="--col:${col}">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="trk"/><circle cx="60" cy="60" r="54" class="val" style="stroke-dasharray:${C};stroke-dashoffset:${C}" data-off="${C * (1 - r.voto / 100)}"/></svg>
        <div class="num"><b id="scoreNum">0</b><small>su 100</small></div>
      </div>
      <h1 class="verdict">${verdict}</h1>
      <div class="rep-chips"><span class="chip ${r.obiettivo ? "ok" : "warn"}">${r.obiettivo ? "Obiettivo raggiunto" : "Obiettivo mancato"}</span><span class="chip ghost">${Math.floor(secs / 60)} min ${secs % 60} s</span>${gained ? `<span class="chip blue">+${gained} punti</span>` : ""}</div>
      <p class="rep-sum">${esc(r.sintesi)}</p>
      <section class="rep-sec good"><h3>${icon("check", "sm")}Cosa hai fatto bene</h3><ul>${r.puntiForti.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <section class="rep-sec bad"><h3>${icon("x", "sm")}Cosa ti è costato</h3><ul>${r.errori.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
      ${r.fraseMigliore ? `<figure class="quote best"><figcaption>La tua frase migliore</figcaption><blockquote>«${esc(r.fraseMigliore)}»</blockquote></figure>` : ""}
      ${r.fraseDaRifare ? `<figure class="quote redo"><figcaption>Hai detto</figcaption><blockquote>«${esc(r.fraseDaRifare)}»</blockquote><figcaption class="try">Prova a dire</figcaption><blockquote>«${esc(r.comeDirla)}»</blockquote></figure>` : ""}
      <div class="rep-tip"><span>${icon("spark")}</span><p><b>Per la prossima telefonata</b>${esc(r.consiglio)}</p></div>
      <div class="btns"><a class="btn white" href="#/sim/${esc(s.id)}" id="again">${icon("phone", "sm")}Richiama</a><a class="btn sec" href="#/allenati">Altri clienti</a></div>
    </div>`;
  const val = view.querySelector(".score .val"), num = $("#scoreNum");
  requestAnimationFrame(() => requestAnimationFrame(() => { val.style.strokeDashoffset = val.dataset.off; }));
  const t1 = performance.now(), dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1100;
  const tick = (t) => { const k = Math.min(1, (t - t1) / dur); num.textContent = Math.round(r.voto * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // Stesso indirizzo: "Richiama" deve ricaricare la telefonata.
  $("#again").onclick = (e) => { e.preventDefault(); viewSim([s.id]); };
}

// ---------- quiz nella lezione ----------
function quizHtml(l) {
  const best = gymNow().quiz[l.id];
  return `<section class="quiz" id="quiz">
    <div class="quiz-hd"><span class="qi">${icon("brain")}</span><div class="grow"><h3>Quiz della lezione</h3><p>${l.quiz.length} ${l.quiz.length === 1 ? "domanda" : "domande"} · superalo con il 70% e prendi 30 punti</p></div>${best != null ? `<span class="chip ${best >= 70 ? "ok" : "warn"}">${best}%</span>` : ""}</div>
    <button class="btn sec block" id="quizGo">${best != null ? "Rifai il quiz" : "Inizia il quiz"}</button>
  </section>`;
}
function runQuiz(l, onPassed) {
  const qs = l.quiz.map((q) => ({ q: q.q, opts: [...q.opts].sort(() => Math.random() - 0.5) }));
  const picked = [];
  let i = 0;
  const box = $("#quiz");
  const draw = () => {
    const q = qs[i];
    box.innerHTML = `<div class="quiz-run">
      <div class="qprog">${qs.map((_, k) => `<i class="${k < i ? "done" : k === i ? "on" : ""}"></i>`).join("")}</div>
      <p class="small muted">Domanda ${i + 1} di ${qs.length}</p>
      <h3>${esc(q.q)}</h3>
      <div class="qopts">${q.opts.map((o, k) => `<button data-o="${k}">${esc(o)}</button>`).join("")}</div></div>`;
    box.querySelectorAll("[data-o]").forEach((b) => (b.onclick = async () => {
      picked[i] = q.opts[Number(b.dataset.o)];
      b.classList.add("sel");
      box.querySelectorAll("[data-o]").forEach((x) => (x.disabled = true));
      await new Promise((ok) => setTimeout(ok, 220));
      if (++i < qs.length) return draw();
      try {
        const d = await api("/quiz", { lessonId: l.id, answers: picked });
        if (d.progress) S.progress = d.progress;
        gain(d);
        box.innerHTML = `<div class="quiz-end ${d.passed ? "ok" : ""}">
          <b class="qpct">${d.pct}%</b><h3>${d.passed ? (d.pct === 100 ? "Perfetto, tutte giuste" : "Quiz superato") : "Non ancora"}</h3>
          <p>${d.right.filter(Boolean).length} risposte giuste su ${qs.length}.${d.passed ? " La lezione è segnata come completata." : " Riguarda il video e riprova: serve il 70%."}</p>
          ${d.solutions ? `<ol class="qsol">${qs.map((q, k) => `<li class="${d.right[k] ? "ok" : "ko"}"><span>${esc(q.q)}</span><b>${esc(d.solutions[k])}</b></li>`).join("")}</ol>` : ""}
          <button class="btn ${d.passed ? "pri" : "sec"} block" id="quizNext">${d.passed ? "Continua" : "Riprova"}</button></div>`;
        $("#quizNext").onclick = () => (d.passed ? onPassed() : runQuiz(l, onPassed));
      } catch (e) { toast(e.message); box.outerHTML = quizHtml(l); }
    }));
  };
  draw();
}

// ---------- certificato ----------
function certBox(m) {
  const code = (S.user.certs || {})[m.id];
  return `<section class="certbox">
    <div class="cb-seal">${icon("check")}</div>
    <div class="grow"><h3>${code ? "Hai il certificato" : "Corso completato"}</h3><p>${code ? `Codice ${esc(code)}. Chiunque può verificarlo inquadrando il QR.` : "Scarica il certificato con il tuo nome e un QR per verificarlo."}</p></div>
    <div class="cb-acts"><button class="btn white" id="certDl">${icon("doc", "sm")}Scarica PDF</button>${code ? `<a class="btn sec" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(certUrl(code))}">Condividi su LinkedIn</a>` : ""}</div>
  </section>`;
}
const certUrl = (code) => `${location.origin}/app/#/verifica/${code}`;
async function downloadCert(m, btn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Preparo il PDF…";
  try {
    const d = await api("/cert", { courseId: m.id });
    S.user = d.user;
    const bytes = await buildCert(d.cert);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `certificato-${m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) { toast(e.message); return false; }
  finally { btn.disabled = false; btn.innerHTML = label; }
}
async function buildCert(c) {
  await Promise.all([loadScript("/app/vendor/pdf-lib.min.js"), loadScript("/app/vendor/qrcode.js")]);
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), it = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const W = 842, H = 595, BLUE = rgb(0.18, 0.42, 1), INK = rgb(0.04, 0.05, 0.08), GREY = rgb(0.45, 0.49, 0.56), LINE = rgb(0.86, 0.88, 0.92), WHITE = rgb(1, 1, 1);
  const p = doc.addPage([W, H]);
  // Fascia nera a sinistra con il marchio
  p.drawRectangle({ x: 0, y: 0, width: 210, height: H, color: INK });
  p.drawRectangle({ x: 210, y: 0, width: 6, height: H, color: BLUE });
  p.drawText("Vendita", { x: 36, y: H - 70, size: 26, font: bold, color: WHITE });
  const uw = bold.widthOfTextAtSize("UNO", 26);
  p.drawRectangle({ x: 34, y: H - 108, width: uw + 16, height: 30, color: BLUE });
  p.drawText("UNO", { x: 42, y: H - 100, size: 26, font: bold, color: WHITE });
  p.drawText("Academy", { x: 36, y: H - 134, size: 12, font: reg, color: rgb(0.62, 0.66, 0.74) });
  // QR di verifica
  const qr = window.qrcode(0, "M"); qr.addData(certUrl(c.code)); qr.make();
  const n = qr.getModuleCount(), size = 130, cell = size / (n + 4), qx = 40, qy = 70;
  p.drawRectangle({ x: qx, y: qy, width: size, height: size, color: WHITE });
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) p.drawRectangle({ x: qx + (k + 2) * cell, y: qy + size - (r + 3) * cell, width: cell, height: cell, color: INK });
  p.drawText("Verifica il certificato", { x: 40, y: 50, size: 9, font: reg, color: rgb(0.62, 0.66, 0.74) });
  p.drawText(c.code, { x: 40, y: 36, size: 11, font: bold, color: WHITE });
  // Testo
  const X = 270, maxW = W - X - 60;
  const fit = (t, font, size, min) => { let s = size; while (s > min && font.widthOfTextAtSize(t, s) > maxW) s -= 1; return s; };
  p.drawText("Certificato di completamento", { x: X, y: H - 96, size: 13, font: bold, color: BLUE });
  p.drawText("Si attesta che", { x: X, y: H - 150, size: 14, font: it, color: GREY });
  const name = pdfText(c.name), ns = fit(name, bold, 46, 24);
  p.drawText(name, { x: X, y: H - 210, size: ns, font: bold, color: INK });
  p.drawLine({ start: { x: X, y: H - 228 }, end: { x: W - 60, y: H - 228 }, thickness: 1, color: LINE });
  p.drawText("ha completato con successo il corso", { x: X, y: H - 262, size: 14, font: it, color: GREY });
  const course = pdfText(c.course), cs = fit(course, bold, 28, 16);
  p.drawText(course, { x: X, y: H - 302, size: cs, font: bold, color: INK });
  if (c.academy) p.drawText(pdfText(`Accademia ${c.academy}  -  ${c.lessons} ${c.lessons === 1 ? "lezione" : "lezioni"}`), { x: X, y: H - 330, size: 12, font: reg, color: GREY });
  // Firma e data
  const date = new Date(c.at).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const col = (x, label, value) => {
    p.drawLine({ start: { x, y: 120 }, end: { x: x + 200, y: 120 }, thickness: 1, color: LINE });
    p.drawText(pdfText(value), { x, y: 128, size: 13, font: bold, color: INK });
    p.drawText(label, { x, y: 104, size: 10, font: reg, color: GREY });
  };
  col(X, "Data", date);
  col(X + 240, c.educator ? "Educatore" : "Rilasciato da", c.educator || "Vendita Uno Academy");
  p.drawText(pdfText(`Verifica online: ${certUrl(c.code)}`), { x: X, y: 50, size: 9, font: reg, color: GREY });
  return doc.save();
}

// Pagina pubblica: chi inquadra il QR vede se il certificato è vero.
async function viewVerify([code = ""]) {
  view.innerHTML = `<div class="verify"><div class="loading"><div class="spin"></div></div></div>`;
  let c = null;
  try {
    const res = await fetch(`/api/app/cert/${encodeURIComponent(code.toUpperCase())}`);
    if (res.ok) c = (await res.json()).cert;
  } catch {}
  $(".verify").innerHTML = c ? `
    <div class="wm" style="font-size:20px;justify-content:center"><span class="v">Vendita</span><span class="u">UNO</span></div>
    <div class="vf-card">
      <div class="vf-ok">${icon("check")}</div>
      <p class="muted">Certificato valido</p>
      <h1>${esc(c.name)}</h1>
      <p>ha completato il corso</p>
      <h2>${esc(c.course)}</h2>
      <dl><div><dt>Accademia</dt><dd>${esc(c.academy || "Vendita Uno")}</dd></div><div><dt>Data</dt><dd>${new Date(c.at).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}</dd></div><div><dt>Codice</dt><dd>${esc(c.code)}</dd></div>${c.educator ? `<div><dt>Educatore</dt><dd>${esc(c.educator)}</dd></div>` : ""}</dl>
    </div>
    <a class="btn pri block" href="#/accedi">Scopri Vendita Uno</a>` : `
    <div class="vf-card"><div class="vf-ok ko">${icon("x")}</div><h1>Certificato non trovato</h1><p class="muted">Controlla il codice${code ? ` ${esc(code)}` : ""}: deve essere quello stampato sotto il QR.</p></div>
    <a class="btn sec block" href="#/accedi">Vai a Vendita Uno</a>`;
}

// Luce che segue il dito o il mouse sul palco (effetto vetro).
document.addEventListener("pointermove", (e) => {
  const st = e.target.closest && e.target.closest(".stage, .callcta, .t3:first-child");
  if (!st) return;
  const r = st.getBoundingClientRect();
  st.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
  st.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
}, { passive: true });

// ---------- avvio ----------
(function start() {
  window.addEventListener("hashchange", router);
  router().then(() => refreshNotifs());
})();
