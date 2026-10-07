"use strict";
// App Vendita Uno: accademia, live, educatori, community, inviti e pannello admin.
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
  const m = s.match(/(?:youtu\.be\/|v=|\/embed\/|\/live\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : "";
}

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
  if (!res.ok) throw new Error(data.error || "Qualcosa è andato storto. Riprova.");
  return data;
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
function liveState(l) {
  const s = new Date(l.start).getTime(), e = s + l.minutes * 60000, n = Date.now();
  return n < s ? "up" : n < e ? "now" : "past";
}
const sortedLives = () => [...S.content.lives].sort((a, b) => a.start.localeCompare(b.start));
const liveNow = () => sortedLives().find((l) => liveState(l) === "now");
const nextLives = (n = 6) => sortedLives().filter((l) => liveState(l) === "up").slice(0, n);
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
  return u ? `<div class="bg" style="background-image:url('${esc(u)}')"></div>` : `<div class="bg gen" style="--c:${color}">${icon(ic || "cap", "big-ic")}</div>`;
}
function courseStats(m) {
  const all = m.lessons.length, done = m.lessons.filter((l) => S.progress[l.id]).length;
  return { all, done, pct: all ? Math.round((done / all) * 100) : 0 };
}
function courseCard(m) {
  const a = academyById(m.academyId), e = eduById(m.educatorId), c = accColor(a), st = courseStats(m);
  const saved = (S.user.saved || []).includes(m.id);
  return `<a class="ccard" href="#/corso/${esc(m.id)}">
    <div class="cov">${coverBg(m.cover, c, a ? a.icon : "cap")}
      <div class="info">
        <h3>${esc(m.title)}</h3>
        ${e ? `<div class="by">${face(e.name, e.photo)}${esc(e.name)}</div>` : ""}
        <div class="meta">
          ${a ? `<div class="ac" style="--c:${c}"><span class="tile">${icon((subOf(m) || a).icon || "cap")}</span><span>${esc(subOf(m) ? subOf(m).name : a.name)}<small>${esc(subOf(m) ? a.name : "Accademia")}</small></span></div>` : ""}
          <span class="lvl ${m.level === "premium" ? "premium" : "base"}"><svg viewBox="0 0 24 24"><path d="M12 2l3 6.6 7 .7-5.3 4.7 1.6 7L12 17.3 5.7 21l1.6-7L2 9.3l7-.7z"/></svg>${m.level === "premium" ? "Premium" : "Base"}</span>
          <span class="acts"><button data-play="${esc(m.id)}" aria-label="Inizia">${icon("play")}</button><button data-save="${esc(m.id)}" class="${saved ? "saved" : ""}" aria-label="Salva">${icon(saved ? "check" : "plus")}</button></span>
        </div>
      </div>
    </div>
    <div class="ft"><span>${icon("cap", "sm")}${st.all} ${st.all === 1 ? "lezione" : "lezioni"}</span><span>${st.done ? `${st.pct}% <span class="prog"><i style="width:${st.pct}%"></i></span>` : "Da iniziare"}</span></div>
  </a>`;
}
function bindCourses(root) {
  root.querySelectorAll("[data-play]").forEach((b) => (b.onclick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const m = courseById(b.dataset.play);
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
function lvItem(l) {
  const e = eduById(l.educatorId) || { name: "Vendita Uno" }, a = academyById(e.academyId);
  const st = liveState(l), d = new Date(l.start), end = new Date(d.getTime() + l.minutes * 60000);
  const day = sameDay(d, new Date()) ? "" : `${DOW[d.getDay()]} ${d.getDate()} · `;
  return `<a class="lv ${st}" href="#/live/${esc(l.id)}" style="--c:${st === "now" ? "#ff3b3b" : accColor(a)}">${face(e.name, e.photo)}<div class="grow"><h4>${esc(l.title)}</h4>
    <div class="t"><span>${st === "now" ? '<span class="pulse"></span> In diretta' : day + fmtTime(d) + " – " + fmtTime(end)}</span><span class="go">${st === "now" ? "Entra ora" : "Partecipa"}</span></div></div></a>`;
}

function gcalUrl(l) {
  const e = eduById(l.educatorId);
  const f = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const s = new Date(l.start), end = new Date(s.getTime() + l.minutes * 60000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: `Live Vendita Uno · ${l.title}`, details: `${e ? "Con " + e.name + ". " : ""}Entra dall'app: ${location.origin}/app/#/live`, dates: `${f(s)}/${f(end)}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// ---------- router ----------
const ROUTES = {
  accedi: { fn: viewAuth, auth: false },
  home: { fn: viewHome, title: "Home", nav: "home" },
  accademia: { fn: viewAcademy, title: "Accademia", nav: "accademia" },
  corso: { fn: viewCourse, title: "Corso", nav: "accademia" },
  lezione: { fn: viewLesson, title: "Lezione", nav: "accademia" },
  live: { fn: viewLive, title: "Live", nav: "live" },
  educatori: { fn: viewEducators, title: "Educatori", nav: "educatori" },
  percorso: { fn: viewAcademyEdu, title: "Accademia", nav: "accademia" },
  educatore: { fn: viewEducator, title: "Educatore", nav: "educatori" },
  community: { fn: viewCommunity, title: "Community", nav: "community" },
  guadagni: { fn: viewEarn, title: "Guadagni", nav: "guadagni" },
  notizie: { fn: viewPremium, title: "Servizio", nav: "notizie" },
  profilo: { fn: viewProfile, title: "Profilo", nav: "" },
  admin: { fn: viewAdmin, title: "Admin", nav: "admin", admin: true, noRail: true },
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [p, qs] = h.split("?");
  const [name, ...args] = p.split("/");
  return { name: name || "home", args: args.map(decodeURIComponent), q: new URLSearchParams(qs || "") };
}

async function router() {
  closeRadial();
  closeSheet();
  const { name, args, q } = parseHash();
  const r = ROUTES[name] || ROUTES.home;
  if (name === "accedi" && !S.user) await loadMe();
  if (r.auth !== false && !S.user) {
    if (!(await loadMe())) { if (name !== "accedi") location.hash = "#/accedi"; else render(); return; }
  }
  if (r.admin && S.user.role !== "admin") { location.hash = "#/home"; return; }
  if (name === "accedi" && S.user) { location.hash = "#/home"; return; }
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
  if (logged) {
    $("#sideMe").innerHTML = userFace(S.user);
    $("#sideAdmin").hidden = S.user.role !== "admin";
    renderRail();
    $("#title").textContent = r.title;
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.nav));
    $("#liveDot").innerHTML = icon("bell") + (liveNow() ? '<span class="dot"></span>' : "");
  }
  window.scrollTo(0, 0);
  r.fn(args, q);
}

async function loadMe() {
  try {
    const d = await api("/me");
    Object.assign(S, { user: d.user, content: d.content, progress: d.progress || {}, reminders: d.reminders || [] });
    return true;
  } catch { return false; }
}

// Pannello a destra (solo computer): live delle prossime 24 ore e onboarding.
function renderRail() {
  const rail = $("#rail");
  if (rail.hidden) return;
  const n = Date.now();
  const soon = sortedLives().filter((l) => liveState(l) === "now" || (liveState(l) === "up" && new Date(l.start).getTime() - n < 86400000));
  const list = soon.length ? soon : nextLives(4);
  rail.innerHTML = `${secHd("Educatori in diretta", soon.length || null)}
    <p class="sub">${soon.length ? "Andranno in diretta entro 24 ore" : "Le prossime live in programma"}</p>
    <div class="lv-list">${list.map(lvItem).join("") || `<div class="card empty">${icon("cal")}Nessuna live in programma.</div>`}</div>
    <a class="btn sec block all" href="#/live">Vedi tutte</a>
    <a class="card teaser mini-onb" href="#/notizie"><span class="lk">${icon("lock")}</span><div class="grow"><h4>Notizie esclusive</h4><p>Le persone da chiamare nella tua zona</p></div>${icon("chev")}</a>`;
}
$("#sideOut").onclick = async () => {
  try { await api("/logout", {}); } catch {}
  S.user = null;
  location.hash = "#/accedi";
};

// ---------- radiale ----------
const radial = $("#radial"), uno = $("#uno");
function closeRadial() { radial.classList.remove("open"); uno.classList.remove("open"); }
uno.onclick = () => { radial.classList.toggle("open"); uno.classList.toggle("open"); };
radial.addEventListener("click", (e) => { if (e.target === radial || e.target.closest("a")) closeRadial(); });

// =====================================================================
// ACCESSO
// =====================================================================
function viewAuth() {
  const ref = (localStorage.getItem("vu_ref") || "").toUpperCase();
  let mode = ref ? "reg" : "login";
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
        <div>${icon("live")} Live ogni settimana con gli educatori</div>
        <div>${icon("users")} Community di agenti in tutta Italia</div>
      </div>
      <div class="seg"><button data-m="reg" class="${mode === "reg" ? "on" : ""}">Registrati</button><button data-m="login" class="${mode === "login" ? "on" : ""}">Accedi</button></div>
      ${mode === "reg" && ref ? `<div class="refnote">${icon("handshake", "sm")} Ti ha invitato un collega (codice ${esc(ref)})</div>` : ""}
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
      if (mode === "reg") data.ref = ref;
      btn.disabled = true;
      try {
        await api(mode === "reg" ? "/register" : "/login", data);
        localStorage.removeItem("vu_ref");
        await loadMe();
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
// HOME
// =====================================================================
function liveCard(l) {
  const e = eduById(l.educatorId) || { name: "Vendita Uno" };
  const st = liveState(l), d = new Date(l.start);
  const when = st === "now" ? `<span class="pulse"></span> In diretta · ${esc(e.name)}` : `${sameDay(d, new Date()) ? "Oggi" : DOW[d.getDay()]} ${fmtTime(d)} · ${esc(e.name)}`;
  return `<a class="card livecard ${st}" href="#/live/${esc(l.id)}">${face(e.name, e.photo)}<div class="grow"><h3>${esc(l.title)}</h3><p>${when}</p></div><span class="go">${st === "now" ? "Entra" : "Vedi"}</span></a>`;
}

function evCard(l) {
  const e = eduById(l.educatorId) || { name: "Vendita Uno" };
  const d = new Date(l.start);
  return `<a class="card ev" href="#/live/${esc(l.id)}"><div class="when">${sameDay(d, new Date()) ? "Oggi" : DOW[d.getDay()] + " " + d.getDate()} · ${fmtTime(d)}</div><h4>${esc(l.title)}</h4><div class="who">${face(e.name, e.photo)}${esc(e.name)}</div></a>`;
}

function viewHome() {
  const set = S.content.settings || {}, ls = allLessons(), done = ls.filter((l) => S.progress[l.id]).length;
  const nl = nextLesson(), now = liveNow(), next = nextLives(8);
  const banners = S.content.banners || [];
  const started = S.content.modules.filter((m) => courseStats(m).done && courseStats(m).done < m.lessons.length);
  const vid = ytId(set.onboardingVideo);
  view.innerHTML = `
    <section class="home-hero"><picture><img src="/app/splash.webp" alt="Vendita Uno. Tutto in uno, tutto per te: formazione, strumenti e una community di professionisti per crescere nel settore immobiliare."></picture></section>
    <div class="home-top">
      <div>
        <p class="hi-name">Ciao ${esc(S.user.name)}, ${esc((set.welcomeSub || "scopri Vendita Uno").replace(/^./, (c) => c.toLowerCase()))}</p>
        <div class="onb" id="onb">
          <button class="onb-hd" id="onbBtn"><span class="pl">${icon("play")}</span><div class="grow"><h3>${esc(set.onboardingTitle || "Inizia da qui")}</h3><p>${esc(set.onboardingText || "")}</p></div><span class="wave"><i></i><i></i><i></i><i></i><i></i></span></button>
          <div id="onbVid"></div>
        </div>
        ${nl && done ? `<div class="acc">
          <div style="display:flex;justify-content:space-between"><span class="chip blue">${icon("cap", "sm")} Continua</span><span class="chip ok">${done} su ${ls.length}</span></div>
          <div class="mod">${esc(nl.module.title)}</div><h3>${esc(nl.title)}</h3>
          <div class="prog"><i style="width:${Math.round((done / ls.length) * 100)}%"></i></div>
          <a class="btn pri block" href="#/lezione/${esc(nl.id)}">${icon("play", "sm")}Continua da dove eri</a></div>` : ""}
      </div>
      ${banners.length ? `<div class="banners" id="bnr"><div class="track">${banners.map((bn) => `<a class="bn ${!bn.title && !bn.text && safeUrl(bn.cover) ? "plain" : ""}" href="${esc(bn.link && /^(#\/|\/|https:\/\/)/.test(bn.link) ? bn.link : "#/home")}">${coverBg(bn.cover, "#2f6bff", "spark")}<h3>${esc(bn.title)}</h3><p>${esc(bn.text)}</p></a>`).join("")}</div>
        ${banners.length > 1 ? `<div class="ctl"><button data-b="-1" aria-label="Precedente">${icon("back")}</button><span class="dots">${banners.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</span><button data-b="1" aria-label="Successivo">${icon("chev")}</button></div>` : ""}</div>` : ""}
    </div>
    ${now ? `<h2 class="sec">In diretta ora</h2>${lvItem(now)}` : ""}
    ${secHd("Accademie", S.content.academies.length, carouselArrows("hAcc"))}
    <div class="acards" id="hAcc">${S.content.academies.map(academyCard).join("")}</div>
    ${secHd(started.length ? "Continua i tuoi corsi" : "Corsi di avvio rapido", null, `<a href="#/accademia">Tutti</a>`)}
    <div class="hcourses" id="hCourses">${(started.length ? started : S.content.modules).map(courseCard).join("") || `<div class="card empty">I corsi arrivano presto.</div>`}</div>
    <div class="hide-desk">
      ${secHd("Prossime live", null, `<a href="#/live">Calendario</a>`)}
      ${next.length ? `<div class="lv-list">${next.slice(0, 3).map(lvItem).join("")}</div>` : `<div class="card empty">${icon("cal")}Nessuna live in programma per ora.</div>`}
    </div>
    <a class="card teaser" href="#/notizie" style="margin-top:20px"><span class="lk">${icon("lock")}</span><div class="grow"><h4>Notizie esclusive nella tua zona</h4><p>${S.user.city ? `Verifica se ${esc(S.user.city)} è ancora libera` : "Scopri il servizio per avere le notizie"}</p></div>${icon("chev")}</a>`;
  bindCourses(view);
  bindScroll(view);
  $("#onbBtn").onclick = () => {
    const box = $("#onbVid");
    box.innerHTML = box.innerHTML ? "" : vid ? `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : `<p class="small muted" style="padding:0 16px 16px">Il video di benvenuto arriva presto.</p>`;
  };
  const bnr = $("#bnr");
  if (bnr && banners.length > 1) {
    let i = 0;
    const go = (d) => {
      i = (i + d + banners.length) % banners.length;
      bnr.querySelector(".track").style.transform = `translateX(-${i * 100}%)`;
      bnr.querySelectorAll(".dots i").forEach((x, k) => x.classList.toggle("on", k === i));
    };
    bnr.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => { go(Number(b.dataset.b)); clearInterval(S.bnrT); }));
    clearInterval(S.bnrT);
    S.bnrT = setInterval(() => { if (document.body.contains(bnr)) go(1); else clearInterval(S.bnrT); }, 6000);
  }
}

// =====================================================================
// ACCADEMIA
// =====================================================================
let acTab = "corsi", acFilter = "";
function viewAcademy() {
  const ls = allLessons(), done = ls.filter((l) => S.progress[l.id]).length;
  const tabs = [["corsi", "Corsi"], ["educatori", "Educatori"], ["live", "Live"]];
  let body = "";
  if (acTab === "corsi") {
    const saved = S.user.saved || [];
    let list = S.content.modules;
    if (acFilter === "_saved") list = list.filter((m) => saved.includes(m.id));
    else if (acFilter) list = list.filter((m) => m.academyId === acFilter);
    const used = S.content.academies.filter((a) => S.content.modules.some((m) => m.academyId === a.id));
    body = `<div class="fchips"><button data-f="" class="${!acFilter ? "on" : ""}">Tutti</button>${saved.length ? `<button data-f="_saved" class="${acFilter === "_saved" ? "on" : ""}">${icon("check", "sm")}Salvati</button>` : ""}${used.map((a) => `<button data-f="${esc(a.id)}" class="${acFilter === a.id ? "on" : ""}" style="--c:${accColor(a)}"><i></i>${esc(a.name)}</button>`).join("")}</div>
      ${acFilter ? `<div class="sec-hd" style="margin-top:4px"><h2>${acFilter === "_saved" ? "I tuoi corsi" : esc((academyById(acFilter) || {}).name || "")}</h2><span class="ln"></span><span class="small muted">${list.length} corsi</span></div>` : `<p class="small muted" style="margin:-4px 0 4px">${done} lezioni completate su ${ls.length}</p>`}
      ${!acFilter ? S.content.academies.filter((a) => S.content.modules.some((m) => m.academyId === a.id)).map((a) => `${secHd(a.name, S.content.modules.filter((m) => m.academyId === a.id).length, `<a href="#/percorso/${esc(a.id)}">Apri</a>`)}<div class="hcourses">${S.content.modules.filter((m) => m.academyId === a.id).map(courseCard).join("")}</div>`).join("")
        : `<div class="courses">${list.map(courseCard).join("") || `<div class="card empty">${icon("cap")}Nessun corso qui, per ora.</div>`}</div>`}
      ${secHd("Accademie", S.content.academies.length, carouselArrows("aAcc"))}
      <div class="acards" id="aAcc">${S.content.academies.map(academyCard).join("")}</div>`;
  } else if (acTab === "educatori") {
    body = `${S.content.educators.map(eduRow).join("") || `<div class="card empty">Nessun educatore.</div>`}`;
  } else {
    const up = sortedLives().filter((l) => liveState(l) !== "past");
    body = `<div class="lv-list">${up.map(lvItem).join("") || `<div class="card empty">${icon("cal")}Nessuna live in programma.</div>`}</div><a class="btn sec block" href="#/live" style="margin-top:14px">${icon("cal", "sm")}Apri il calendario</a>`;
  }
  view.innerHTML = `<div class="utabs">${tabs.map(([k, n]) => `<button data-t="${k}" class="${acTab === k ? "on" : ""}">${n}</button>`).join("")}</div>${body}`;
  view.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { acTab = b.dataset.t; viewAcademy(); }));
  view.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { acFilter = b.dataset.f; viewAcademy(); }));
  bindCourses(view);
  bindScroll(view);
}

function viewCourse([id]) {
  const m = courseById(id);
  if (!m) { location.hash = "#/accademia"; return; }
  const a = academyById(m.academyId), e = eduById(m.educatorId), c = accColor(a), st = courseStats(m);
  const next = m.lessons.find((l) => !S.progress[l.id]) || m.lessons[0];
  const saved = (S.user.saved || []).includes(m.id);
  view.innerHTML = `
    <div class="chero">${coverBg(m.cover, c, a ? a.icon : "cap")}
      <a class="back" href="#/accademia">${icon("back", "sm")} Accademia</a>
      <div class="info">
        <div class="row" style="gap:8px;flex-wrap:wrap">${a ? `<a class="chip" href="#/percorso/${esc(a.id)}" style="background:${c};color:#fff;text-decoration:none">${esc(a.name)}${subOf(m) ? " › " + esc(subOf(m).name) : ""}</a>` : ""}<span class="lvl ${m.level === "premium" ? "premium" : "base"}">${m.level === "premium" ? "Premium" : "Base"}</span></div>
        <h1>${esc(m.title)}</h1>
        ${e ? `<a class="row" href="#/educatore/${esc(e.id)}" style="gap:8px;margin-top:10px;text-decoration:none;font-size:13px;color:#d3dcef">${face(e.name, e.photo)}${esc(e.name)}</a>` : ""}
      </div>
    </div>
    <div class="narrow">
    ${m.desc ? `<p class="lead-tx" style="line-height:1.55;margin-top:16px">${esc(m.desc)}</p>` : ""}
    <div class="card pad" style="margin-top:16px"><div class="row"><div class="grow"><b style="font-family:var(--display);font-size:15px">${st.done} di ${st.all} lezioni</b><div class="prog" style="margin-top:8px"><i style="width:${st.pct}%"></i></div></div><span style="font-family:var(--display);font-weight:800;font-size:22px">${st.pct}%</span></div>
    <div class="btns">${next ? `<a class="btn pri" href="#/lezione/${esc(next.id)}">${icon("play", "sm")}${st.done ? "Continua" : "Inizia"}</a>` : `<span></span>`}<button class="btn sec ${saved ? "on" : ""}" data-save="${esc(m.id)}">${icon(saved ? "check" : "plus", "sm")}${saved ? "Salvato" : "Salva"}</button></div></div>
    <h2 class="sec">Lezioni</h2>
    <div class="card">${m.lessons.map((l, i) => `<a class="les" href="#/lezione/${esc(l.id)}"><span class="st ${S.progress[l.id] ? "done" : ""}">${S.progress[l.id] ? icon("check", "sm") : i + 1}</span><div class="grow"><h4>${esc(l.title)}</h4><p>${l.minutes ? l.minutes + " min" : "Video"}${l.pdf ? " · PDF" : ""}</p></div>${icon("chev", "sm")}</a>`).join("") || `<div class="empty">Le lezioni arrivano presto.</div>`}</div>
    </div>`;
  const sb = view.querySelector("[data-save]");
  sb.onclick = async () => {
    try { S.user = (await api("/save", { courseId: m.id, on: !saved })).user; viewCourse([id]); toast(saved ? "Tolto dai tuoi corsi" : "Salvato nei tuoi corsi"); } catch (err) { toast(err.message); }
  };
}

function viewLesson([id]) {
  const ls = allLessons(), i = ls.findIndex((l) => l.id === id);
  if (i < 0) { location.hash = "#/accademia"; return; }
  const l = ls[i], prev = ls[i - 1], next = ls[i + 1];
  const yid = ytId(l.youtubeId);
  const draw = () => {
    const done = !!S.progress[l.id];
    view.innerHTML = `
      <div class="les-wrap"><a class="back" href="#/corso/${esc(l.module.id)}">${icon("back", "sm")} ${esc(l.module.title)}</a>
      <div class="player">${yid ? `<iframe src="https://www.youtube-nocookie.com/embed/${yid}?rel=0&modestbranding=1" title="${esc(l.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>` : `<div class="ph">${icon("play")}Video in arrivo</div>`}</div>
      <div class="small" style="color:var(--blue-3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-top:16px">${esc(l.module.title)} · lezione ${l.module.lessons.indexOf(S.content.modules[l.mi].lessons.find((x) => x.id === l.id)) + 1} di ${l.module.lessons.length}</div>
      <h1 class="h1" style="font-size:22px;margin-top:4px">${esc(l.title)}</h1>
      ${l.desc ? `<p class="lead-tx" style="line-height:1.55;white-space:pre-wrap">${esc(l.desc)}</p>` : ""}
      ${safeUrl(l.pdf) ? `<a class="card teaser" href="${esc(safeUrl(l.pdf))}" target="_blank" rel="noopener"><span class="lk">${icon("doc")}</span><div class="grow"><h4>Materiale della lezione</h4><p>Scarica il PDF</p></div>${icon("chev")}</a>` : ""}
      <button class="btn ${done ? "on sec" : "pri"} block" id="done" style="margin-top:16px">${icon("check", "sm")}${done ? "Completata" : "Segna come completata"}</button>
      <div class="les-nav">
        ${prev ? `<a class="btn sec" href="#/lezione/${esc(prev.id)}">${icon("back", "sm")}Precedente</a>` : "<span></span>"}
        ${next ? `<a class="btn sec" href="#/lezione/${esc(next.id)}">Successiva${icon("chev", "sm")}</a>` : "<span></span>"}
      </div></div>`;
    $("#done").onclick = async () => {
      try {
        const d = await api("/progress", { lessonId: l.id, done: !done });
        S.progress = d.progress;
        if (!done && next) { toast("Lezione completata"); location.hash = `#/lezione/${next.id}`; }
        else { if (!done) toast("Hai finito l'accademia!"); draw(); }
      } catch (e) { toast(e.message); }
    };
  };
  draw();
}

// =====================================================================
// LIVE
// =====================================================================
function weekStart(offset) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

function viewLive([liveId]) {
  if (liveId) {
    const l = S.content.lives.find((x) => x.id === liveId);
    if (l) {
      S.selLive = l.id;
      const ws = weekStart(0), diff = Math.floor((new Date(l.start) - ws) / (7 * 86400000));
      S.week = diff;
    }
  }
  drawLive();
}

function drawLive() {
  const ws = weekStart(S.week), we = new Date(ws.getTime() + 7 * 86400000);
  const days = [...Array(7)].map((_, i) => new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i));
  const lives = sortedLives().filter((l) => { const d = new Date(l.start); return d >= ws && d < we; });
  const today = new Date();
  // Righe: educatori con live in settimana; se non ce ne sono, tutti (fino a 6).
  const withLive = S.content.educators.filter((e) => lives.some((l) => l.educatorId === e.id));
  const rows = withLive.length ? withLive : S.content.educators.slice(0, 6);
  if (!lives.some((l) => l.id === S.selLive)) S.selLive = (lives.find((l) => liveState(l) === "now") || lives.find((l) => liveState(l) === "up") || lives[0] || {}).id;
  const end = new Date(we.getTime() - 1);
  const range = ws.getMonth() === end.getMonth() ? `${ws.getDate()} – ${end.getDate()} ${end.toLocaleDateString("it-IT", { month: "long" })}` : `${ws.getDate()} ${ws.toLocaleDateString("it-IT", { month: "short" })} – ${end.getDate()} ${end.toLocaleDateString("it-IT", { month: "short" })}`;

  const slot = (l) => {
    const st = liveState(l), d = new Date(l.start);
    return `<button class="slot ${st} ${l.id === S.selLive ? "sel" : ""} ${S.reminders.includes(l.id) ? "rem" : ""}" data-live="${esc(l.id)}">${st === "now" ? "LIVE" : fmtTime(d)}<small>${st === "past" ? (l.replayUrl ? "replay" : "fatta") : st === "now" ? fmtTime(d) : l.minutes + "′"}</small></button>`;
  };

  view.innerHTML = `
    <div class="wk">
      <div><h3>${S.week === 0 ? "Live della settimana" : S.week === 1 ? "Settimana prossima" : S.week === -1 ? "Settimana scorsa" : "Live"}</h3><p>${range} · tocca una live</p></div>
      <div class="arr"><button data-w="-1" aria-label="Settimana precedente">${icon("back")}</button><button data-w="1" aria-label="Settimana successiva">${icon("chev")}</button></div>
    </div>
    <div class="card cal">
      <div class="r hd"><span></span>${days.map((d) => `<div class="d ${sameDay(d, today) ? "today" : ""}">${DOW[d.getDay()]}<b>${d.getDate()}</b></div>`).join("")}</div>
      ${rows.map((e) => `<div class="r rw"><a class="ed" href="#/educatore/${esc(e.id)}">${face(e.name, e.photo)}${esc(e.name.split(" ")[0])}</a>${days.map((d) => {
        const ll = lives.filter((l) => l.educatorId === e.id && sameDay(new Date(l.start), d));
        return `<div class="cell ${sameDay(d, today) ? "today" : ""}">${ll.slice(0, 2).map(slot).join("")}</div>`;
      }).join("")}</div>`).join("") || `<div class="empty">Aggiungi gli educatori dal pannello admin.</div>`}
    </div>
    <div class="legend"><span><i style="background:var(--red)"></i>In diretta</span><span><i style="background:rgba(47,107,255,.5)"></i>In programma</span><span><i style="background:var(--line-2)"></i>Passata</span><span><i style="background:var(--sky);border-radius:50%"></i>Promemoria</span></div>
    <div id="det"></div>
    ${lives.length ? `<h2 class="sec">Tutte le live della settimana</h2><div class="card" style="padding:0 14px">${lives.map((l) => {
      const d = new Date(l.start), e = eduById(l.educatorId) || { name: "" }, st = liveState(l);
      return `<button class="lrow" data-live="${esc(l.id)}"><div class="dt"><span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b></div><div class="grow"><h4>${esc(l.title)}</h4><p>${fmtTime(d)} · ${esc(e.name)}${st === "now" ? ' · <span style="color:#ff6b6b">in diretta</span>' : st === "past" ? " · passata" : ""}</p></div>${icon("chev", "sm")}</button>`;
    }).join("")}</div>` : ""}`;

  view.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => { S.week += Number(b.dataset.w); S.selLive = null; drawLive(); }));
  view.querySelectorAll("[data-live]").forEach((b) => (b.onclick = () => {
    S.selLive = b.dataset.live;
    drawLive();
    $("#det").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  drawDetail();
}

function drawDetail() {
  const box = $("#det");
  const l = S.content.lives.find((x) => x.id === S.selLive);
  if (!l) { box.innerHTML = `<div class="card det empty">${icon("cal")}Nessuna live in questa settimana.</div>`; return; }
  const e = eduById(l.educatorId) || { name: "Vendita Uno", role: "" };
  const st = liveState(l), d = new Date(l.start), on = S.reminders.includes(l.id);
  const enterUrl = safeUrl(l.url), replay = safeUrl(l.replayUrl);
  const when = st === "now" ? `<span class="pulse"></span><span style="color:#ff6b6b">In diretta ora</span>` : `${esc(fmtDay(d))} · ${fmtTime(d)}`;
  let btns;
  if (st === "now") btns = enterUrl ? `<button class="btn live" data-enter>${icon("live", "sm")}Entra in live</button>` : `<button class="btn live" disabled>${icon("live", "sm")}Link in arrivo</button>`;
  else if (st === "past") btns = replay ? `<button class="btn pri" data-replay>${icon("play", "sm")}Guarda replay</button>` : `<button class="btn sec" disabled>Replay in arrivo</button>`;
  else btns = `<button class="btn sec ${on ? "on" : ""}" data-remind>${icon(on ? "check" : "bell", "sm")}${on ? "Ti avviso io" : "Ricordamelo"}</button>`;
  const second = st === "up" ? `<a class="btn sec" href="${esc(gcalUrl(l))}" target="_blank" rel="noopener">${icon("cal", "sm")}Calendario</a>` : `<a class="btn sec" href="#/educatore/${esc(e.id || "")}">${icon("user", "sm")}Educatore</a>`;
  box.innerHTML = `<div class="card det">
    <div class="top">${face(e.name, e.photo)}<div class="grow"><div class="when">${when}</div><h3>${esc(l.title)}</h3></div></div>
    ${l.desc ? `<p>${esc(l.desc)}</p>` : ""}
    <div class="info"><span><b>${esc(e.name)}</b></span>${e.role ? `<span>${esc(e.role)}</span>` : ""}<span>${l.minutes} min</span></div>
    <div class="btns">${btns}${second}</div></div>`;
  const r = box.querySelector("[data-remind]");
  if (r) r.onclick = async () => {
    try {
      const d = await api("/remind", { liveId: l.id, on: !on });
      S.reminders = d.reminders;
      drawLive();
      if (!on) { toast("Ti ricordiamo la live 15 minuti prima"); notifySoon(l); }
    } catch (err) { toast(err.message); }
  };
  const open = (u, title) => {
    const y = ytId(u);
    if (y) openSheet(title, `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${y}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div><p class="small muted" style="margin-top:10px">${esc(l.title)}</p>`);
    else window.open(u, "_blank", "noopener");
  };
  const en = box.querySelector("[data-enter]");
  if (en) en.onclick = () => open(enterUrl, "In diretta");
  const rp = box.querySelector("[data-replay]");
  if (rp) rp.onclick = () => open(replay, "Replay");
}

// Promemoria nel browser: notifica 15 minuti prima se l'app è aperta (le email arriveranno in seguito).
const timers = {};
async function notifySoon(l) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} }
  scheduleReminders();
}
function scheduleReminders() {
  if (!S.content || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const id of S.reminders) {
    const l = S.content.lives.find((x) => x.id === id);
    if (!l || timers[id]) continue;
    const ms = new Date(l.start).getTime() - 15 * 60000 - Date.now();
    if (ms > 0 && ms < 2 ** 31 - 1) timers[id] = setTimeout(() => new Notification("Tra 15 minuti: live Vendita Uno", { body: l.title, icon: "/app/icon-192.png" }), ms);
  }
}

// =====================================================================
// EDUCATORI
// =====================================================================
function eduRow(e) {
  const a = academyById(e.academyId);
  const up = S.content.lives.filter((l) => l.educatorId === e.id && liveState(l) !== "past").length;
  return `<a class="card edu-row" href="#/educatore/${esc(e.id)}">${face(e.name, e.photo)}<div class="grow"><h4>${esc(e.name)}</h4><p>${esc(e.role || (a ? a.name : ""))}${up ? ` · ${up} live in programma` : ""}</p></div>${icon("chev")}</a>`;
}

function viewEducators(_, q) {
  let tab = q.get("tab") === "seguiti" ? "seguiti" : "scopri";
  const draw = (term = "") => {
    const t = term.trim().toLowerCase();
    let body;
    if (t) {
      const found = S.content.educators.filter((e) => [e.name, e.role, (academyById(e.academyId) || {}).name].join(" ").toLowerCase().includes(t));
      body = `<h2 class="sec">Risultati</h2>${found.map(eduRow).join("") || `<div class="card empty">Nessun educatore trovato.</div>`}`;
    } else if (tab === "seguiti") {
      const f = S.content.educators.filter((e) => (S.user.following || []).includes(e.id));
      body = `<h2 class="sec">Educatori che segui</h2>${f.map(eduRow).join("") || `<div class="card empty">${icon("users")}Non segui ancora nessun educatore.</div>`}`;
    } else {
      body = `<div class="path"><h3>Scegli il tuo percorso</h3><p>Educatori raggruppati per accademia</p></div>
        <div class="grid">${S.content.academies.map((a) => {
          const n = S.content.educators.filter((e) => e.academyId === a.id).length;
          return `<a class="acad" href="#/percorso/${esc(a.id)}" style="--c:${accColor(a)}"><span class="ic">${icon(a.icon || "cap")}</span><h4>${esc(a.name)}</h4><div class="ct">${n} ${n === 1 ? "educatore" : "educatori"} ${icon("chev")}</div></a>`;
        }).join("")}</div>
        <h2 class="sec">Tutti gli educatori</h2>${S.content.educators.map(eduRow).join("")}`;
    }
    $("#eduBody").innerHTML = body;
  };
  view.innerHTML = `
    <label class="search">${icon("search")}<input id="eduQ" placeholder="Cerca educatori, percorsi…" autocomplete="off"></label>
    <div class="seg" style="margin-top:12px"><button data-t="scopri" class="${tab === "scopri" ? "on" : ""}">Scopri</button><button data-t="seguiti" class="${tab === "seguiti" ? "on" : ""}">Seguiti</button></div>
    <div id="eduBody"></div>`;
  $("#eduQ").oninput = (e) => draw(e.target.value);
  view.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => {
    tab = b.dataset.t;
    view.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
    $("#eduQ").value = "";
    draw();
  }));
  draw();
}

let pTab = "corsi", pSub = "";
function viewAcademyEdu([id]) {
  const a = academyById(id);
  if (!a) { location.hash = "#/accademia"; return; }
  if (S.pAcad !== id) { S.pAcad = id; pSub = ""; }
  const c = accColor(a), subs = a.subs || [];
  const eds = S.content.educators.filter((e) => e.academyId === id);
  const mods = S.content.modules.filter((m) => m.academyId === id);
  const lives = sortedLives().filter((l) => liveState(l) !== "past" && eds.some((e) => e.id === l.educatorId));
  const tabs = [["corsi", `Corsi · ${mods.length}`], ["educatori", `Educatori · ${eds.length}`], ["live", `Live · ${lives.length}`]];
  let body;
  if (pTab === "corsi") {
    const groups = [...subs.map((sb) => ({ sb, list: mods.filter((m) => m.subId === sb.id) })), { sb: null, list: mods.filter((m) => !subs.some((x) => x.id === m.subId)) }].filter((g) => g.list.length && (!pSub || (g.sb && g.sb.id === pSub)));
    body = `${subs.length ? `<div class="subs">${subs.map((sb) => { const n = mods.filter((m) => m.subId === sb.id).length; return `<button class="subt ${pSub === sb.id ? "on" : ""}" data-sub="${esc(sb.id)}" style="--c:${c}"><span class="ic">${icon(sb.icon || "cap")}</span><span class="grow"><b>${esc(sb.name)}</b><small>${n} ${n === 1 ? "corso" : "corsi"}</small></span></button>`; }).join("")}</div>` : ""}
      ${groups.map((g) => `${secHd(g.sb ? g.sb.name : "Altri corsi", g.list.length)}<div class="courses">${g.list.map(courseCard).join("")}</div>`).join("") || `<div class="card empty">${icon("cap")}I corsi di questa sezione arrivano presto.</div>`}`;
  } else if (pTab === "educatori") body = eds.map(eduRow).join("") || `<div class="card empty">${icon("users")}Presto nuovi educatori in questa accademia.</div>`;
  else body = `<div class="lv-list">${lives.map(lvItem).join("") || `<div class="card empty">${icon("cal")}Nessuna live in programma.</div>`}</div>`;
  view.innerHTML = `
    <div class="ahero">${coverBg(a.hero || a.cover, c, a.icon)}
      <a class="back" href="#/accademia" style="position:absolute;top:24px;left:16px;margin:0">${icon("back", "sm")} Accademie</a>
      <span class="tile" style="--c:${c}">${icon(a.icon || "cap")}</span>
      <h1>${esc(a.name)}</h1><p>${subs.length ? `${subs.length} sezioni · ` : ""}${mods.length} ${mods.length === 1 ? "corso" : "corsi"} · ${eds.length} ${eds.length === 1 ? "educatore" : "educatori"}</p>
    </div>
    <div class="utabs">${tabs.map(([k, n]) => `<button data-t="${k}" class="${pTab === k ? "on" : ""}">${n}</button>`).join("")}</div>
    ${body}`;
  view.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { pTab = b.dataset.t; viewAcademyEdu([id]); }));
  view.querySelectorAll("[data-sub]").forEach((b) => (b.onclick = () => { pSub = pSub === b.dataset.sub ? "" : b.dataset.sub; viewAcademyEdu([id]); }));
  bindCourses(view);
}

async function viewEducator([id]) {
  const e = eduById(id);
  if (!e) { location.hash = "#/educatori"; return; }
  const a = academyById(e.academyId);
  const lives = sortedLives().filter((l) => l.educatorId === id);
  const up = lives.filter((l) => liveState(l) !== "past"), past = lives.filter((l) => liveState(l) === "past");
  const following = (S.user.following || []).includes(id);
  view.innerHTML = `
    <a class="back" href="#/educatori">${icon("back", "sm")} Educatori</a>
    <div class="card prof">
      ${face(e.name, e.photo)}
      <h3>${esc(e.name)}</h3>
      <div class="role">${esc([a && a.name, e.role].filter(Boolean).join(" · "))}</div>
      ${e.bio ? `<p class="bio">${esc(e.bio)}</p>` : ""}
      <div class="nums"><div><b>${up.length}</b><span>In programma</span></div><div><b>${past.length}</b><span>Live fatte</span></div></div>
      <button class="follow ${following ? "on" : ""}" id="follow">${following ? "Seguito" : "Segui"}</button>
    </div>
    ${S.content.modules.some((m) => m.educatorId === id) ? `<h2 class="sec">Corsi</h2><div class="hcourses">${S.content.modules.filter((m) => m.educatorId === id).map(courseCard).join("")}</div>` : ""}
    <h2 class="sec">Prossime live</h2>
    <div class="card" style="padding:0 14px">${up.map((l) => { const d = new Date(l.start); return `<a class="lrow" href="#/live/${esc(l.id)}" style="text-decoration:none"><div class="dt"><span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b></div><div class="grow"><h4>${esc(l.title)}</h4><p>${fmtTime(d)} · ${l.minutes} min${liveState(l) === "now" ? ' · <span style="color:#ff6b6b">in diretta</span>' : ""}</p></div>${icon("chev", "sm")}</a>`; }).join("") || `<div class="empty">Nessuna live in programma.</div>`}</div>
    <h2 class="sec">Post</h2><div id="eduPosts"><div class="loading" style="min-height:80px"><div class="spin"></div></div></div>`;
  bindCourses(view);
  $("#follow").onclick = async () => {
    try {
      const d = await api("/follow", { educatorId: id, on: !following });
      S.user = d.user;
      viewEducator([id]);
      if (!following) toast(`Segui ${e.name}`);
    } catch (err) { toast(err.message); }
  };
  try {
    const d = await api(`/posts?educator=${encodeURIComponent(id)}`);
    const box = $("#eduPosts");
    if (!box) return;
    box.innerHTML = d.posts.map(postHtml).join("") || `<div class="card empty">Nessun post ancora.</div>`;
    bindPosts(box, d.posts);
  } catch {}
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
  let image = "";
  view.innerHTML = `
    <div class="card compose">
      <div class="row" style="align-items:flex-start">${userFace(S.user)}<textarea id="ptx" placeholder="Racconta un incarico preso, fai una domanda…" maxlength="2000" rows="2"></textarea></div>
      <div class="prev" id="pprev" hidden></div>
      <div class="bar"><label style="color:var(--blue-2);cursor:pointer;display:flex">${icon("image")}<input type="file" accept="image/*" id="pimg" hidden></label><button class="btn pri" id="psend">Pubblica</button></div>
    </div>
    <div id="feed"><div class="loading" style="min-height:120px"><div class="spin"></div></div></div>
    <div id="more"></div>`;
  view.querySelector(".compose .av, .compose .ini").style.cssText = "width:34px;height:34px;font-size:12px";
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
async function viewEarn() {
  view.innerHTML = `<div class="loading"><div class="spin"></div></div>`;
  let d;
  try { d = await api("/network"); } catch (e) { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const link = `${location.origin}/app/?ref=${d.refCode}`;
  const eur = (n) => "€ " + (Number(n) || 0).toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const person = (p) => `<div class="ln">${face(p.name, imgUrl(p.avatar))}<div class="grow"><h4>${esc(p.name)}</h4><p>${esc(p.city || "—")} · dal ${new Date(p.at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}</p></div></div>`;
  view.innerHTML = `
    <div class="wallet">
      <small>Totale maturato</small>
      <div class="big">${eur(d.earnings.total)}</div>
      <div class="rw"><div><b>${eur(d.earnings.available)}</b>Disponibile</div><div><b>${eur(d.earnings.pending)}</b>In attesa</div><div><b>${d.level1.length + d.level2.length}</b>Nella tua rete</div></div>
    </div>
    <div class="card invite pad" style="margin-top:12px">
      <h2 class="sec" style="margin:0">Il tuo link invito</h2>
      <p class="small muted" style="margin-top:4px">Chi si registra con il tuo link entra nella tua rete. Guadagni una parte su quello che acquista.</p>
      <div class="link">${icon("link", "sm")}<span>${esc(link.replace(/^https?:\/\//, ""))}</span><button id="copy">Copia</button></div>
      ${navigator.share ? `<button class="btn sec block" id="share" style="margin-top:8px">${icon("share", "sm")}Condividi su WhatsApp e altre app</button>` : ""}
    </div>
    <h2 class="sec">Come guadagni</h2>
    <div class="card split">
      <div class="ln"><span class="ic">${icon("handshake")}</span><div class="grow"><h4>Persone che porti tu</h4><p>Una percentuale su abbonamenti e servizi che acquistano</p></div></div>
      <div class="ln"><span class="ic">${icon("users")}</span><div class="grow"><h4>Secondo livello</h4><p>Una parte più piccola su chi portano le persone della tua rete</p></div></div>
      <div class="ln"><span class="ic">${icon("cap")}</span><div class="grow"><h4>Educatori</h4><p>Una quota sulle vendite che arrivano dal tuo pubblico</p></div></div>
    </div>
    <h2 class="sec">La tua rete <span class="small muted">${d.level1.length} dirette</span></h2>
    <div class="card split">${d.level1.map(person).join("") || `<div class="empty">${icon("users")}Ancora nessuno. Condividi il tuo link!</div>`}</div>
    ${d.level2.length ? `<h2 class="sec">Secondo livello <span class="small muted">${d.level2.length}</span></h2><div class="card split">${d.level2.map(person).join("")}</div>` : ""}`;
  $("#copy").onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast("Link copiato"); } catch { prompt("Copia il link:", link); }
  };
  const sh = $("#share");
  if (sh) sh.onclick = () => navigator.share({ title: "Vendita Uno", text: "Entra nell'accademia Vendita Uno per agenti immobiliari:", url: link }).catch(() => {});
}

// =====================================================================
// SERVIZIO NOTIZIE ESCLUSIVE
// =====================================================================
function viewPremium() {
  const u = S.user;
  view.innerHTML = `
    <div class="prem">
      <span class="lk">${icon("lock")}</span>
      <h3>Notizie esclusive nella tua zona</h3>
      <p>In accademia impari il metodo. Con il servizio lo applichi: ti diamo noi le persone da chiamare, solo a te, nella tua zona.</p>
      <ul>
        <li>${icon("check")}<span><b>Zona esclusiva</b>: nessun'altra agenzia della tua zona riceve le stesse notizie</span></li>
        <li>${icon("check")}<span>Privati che vendono, successioni, trasferimenti, immobili sfitti</span></li>
        <li>${icon("check")}<span>Gestionale per segnare chiamate, appuntamenti e incarichi</span></li>
        <li>${icon("check")}<span>Affiancamento 1-a-1 con un educatore nei primi 30 giorni</span></li>
      </ul>
    </div>
    <h2 class="sec">Verifica se la tua zona è libera</h2>
    <form class="card pad" id="zf">
      <label class="field"><span>Comune o quartiere</span><input class="inp" name="comune" value="${esc(u.city || "")}" required></label>
      <label class="field"><span>Telefono</span><input class="inp" name="phone" type="tel" value="${esc(u.phone || "")}" required></label>
      <label class="field"><span>Note (facoltativo)</span><textarea class="inp" name="note" rows="2" placeholder="Es. lavoro anche nei comuni vicini"></textarea></label>
      <div id="zerr"></div>
      <button class="btn pri block">${icon("pin", "sm")}Invia richiesta</button>
      <p class="small muted" style="margin-top:10px;text-align:center">Ti richiamiamo entro 24 ore per spiegarti il servizio.</p>
    </form>
    <a class="btn sec block" href="/provegestionale" target="_blank" style="margin-top:12px">${icon("search", "sm")}Guarda come funziona il gestionale</a>`;
  $("#zf").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api("/zone", Object.fromEntries(new FormData(e.target)));
      e.target.innerHTML = `<div class="empty" style="color:var(--text)">${icon("check")}<b>Richiesta inviata.</b><br><span class="muted">Ti chiamiamo entro 24 ore.</span></div>`;
    } catch (err) { $("#zerr").innerHTML = `<div class="err">${esc(err.message)}</div>`; btn.disabled = false; }
  };
}

// =====================================================================
// PROFILO
// =====================================================================
function viewProfile() {
  const u = S.user;
  const roleName = { admin: "Amministratore", educator: "Educatore", agent: "Agente" }[u.role] || "Agente";
  view.innerHTML = `
    <div class="me-hd">
      <div class="avedit">${userFace(u)}<label aria-label="Cambia foto">${icon("camera")}<input type="file" accept="image/*" id="avf" hidden></label></div>
      <div class="grow"><h1 class="h1" style="font-size:22px">${esc(fullName(u))}</h1><p class="muted small" style="margin-top:4px">${roleName}${u.city ? " · " + esc(u.city) : ""}</p></div>
    </div>
    <div class="card menu" style="margin-top:20px">
      <a href="#/guadagni">${icon("wallet")}Guadagni e inviti${icon("chev", "chev")}</a>
      <a href="#/educatori?tab=seguiti">${icon("users")}Educatori che segui${icon("chev", "chev")}</a>
      <a href="#/notizie">${icon("lock")}Notizie esclusive${icon("chev", "chev")}</a>
      ${u.role === "admin" ? `<a href="#/admin">${icon("shield")}Pannello admin${icon("chev", "chev")}</a>` : ""}
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
    <button class="btn danger block" id="logout" style="margin-top:20px">${icon("logout", "sm")}Esci</button>`;
  $("#avf").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { S.user = (await api("/avatar", { dataUrl: await resizeImage(f, 360) })).user; toast("Foto aggiornata"); viewProfile(); } catch (err) { toast(err.message); }
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
const ICONS = ["key", "handshake", "phone", "mega", "brain", "euro", "doc", "spark", "trend", "tool", "home2", "cap", "camera", "users", "live"];
let adminTab = "live";

function viewAdmin() {
  const tabs = [["live", "Live"], ["home", "Home"], ["accademia", "Corsi"], ["educatori", "Educatori"], ["percorsi", "Accademie"], ["utenti", "Utenti"], ["zone", "Richieste zona"]];
  view.innerHTML = `<h1 class="h1">Pannello admin</h1><p class="lead-tx" style="margin-bottom:14px">Qui gestisci contenuti, live e utenti dell'app.</p>
    <div class="tabs">${tabs.map(([k, n]) => `<button data-a="${k}" class="${adminTab === k ? "on" : ""}">${n}</button>`).join("")}</div><div id="adm"></div>`;
  view.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => { adminTab = b.dataset.a; viewAdmin(); }));
  ({ live: admLives, home: admHome, accademia: admModules, educatori: admEducators, percorsi: admAcademies, utenti: admUsers, zone: admZones })[adminTab]();
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
  openSheet(title, `<form id="sf">${html}<div id="serr"></div><button class="btn pri block">Salva</button>${onDelete ? `<button type="button" class="btn danger block" id="sdel" style="margin-top:8px">${icon("trash", "sm")}Elimina</button>` : ""}</form>`, (root) => {
    root.querySelector("#sf").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button.pri");
      btn.disabled = true;
      try { await onSave(Object.fromEntries(new FormData(e.target)), e.target); } catch (err) { root.querySelector("#serr").innerHTML = `<div class="err">${esc(err.message)}</div>`; btn.disabled = false; }
    };
    bindImgFields(root);
    if (onDelete) root.querySelector("#sdel").onclick = () => { if (confirm("Sicuro di voler eliminare?")) onDelete().catch((err) => toast(err.message)); };
  });
}

function bindList(root, list, section, edit) {
  root.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => edit(Number(b.dataset.edit))));
  root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    if (!confirm("Sicuro di voler eliminare?")) return;
    const copy = list.slice(); copy.splice(Number(b.dataset.del), 1);
    saveSection(section, copy, "Eliminato").catch((e) => toast(e.message));
  }));
  root.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.up), copy = list.slice();
    [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
    saveSection(section, copy, "Ordine aggiornato").catch((e) => toast(e.message));
  }));
}

// Converte la data della live nel formato del campo "datetime-local" (ora locale).
const toLocalInput = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function admLives() {
  const lives = sortedLives();
  const upcoming = lives.filter((l) => liveState(l) !== "past"), past = lives.filter((l) => liveState(l) === "past").reverse();
  const row = (l) => { const i = lives.indexOf(l), d = new Date(l.start), e = eduById(l.educatorId); return `<div class="adm-item"><div class="grow"><h4>${esc(l.title)}</h4><p>${DOW[d.getDay()]} ${d.toLocaleDateString("it-IT")} ${fmtTime(d)} · ${esc(e ? e.name : "—")}${l.url ? "" : ' · <span style="color:var(--warn)">manca link</span>'}</p></div>${itemActs(i, lives.length, false)}</div>`; };
  $("#adm").innerHTML = `<button class="btn pri block" id="add">${icon("plus", "sm")}Nuova live</button>
    <h2 class="sec">In programma</h2><div class="card">${upcoming.map(row).join("") || `<div class="empty">Nessuna live in programma</div>`}</div>
    ${past.length ? `<h2 class="sec">Passate</h2><div class="card">${past.slice(0, 30).map(row).join("")}</div>` : ""}`;
  const edit = (i) => {
    const l = i >= 0 ? lives[i] : { title: "", desc: "", educatorId: (S.content.educators[0] || {}).id, start: new Date(Date.now() + 86400000).toISOString(), minutes: 60, url: "", replayUrl: "" };
    formSheet(i >= 0 ? "Modifica live" : "Nuova live",
      field("Titolo", "title", l.title, "text", "required") +
      select("Educatore", "educatorId", S.content.educators.map((e) => [e.id, e.name]), l.educatorId) +
      `<div class="two">${field("Data e ora", "start", toLocalInput(l.start), "datetime-local", "required")}${field("Durata (minuti)", "minutes", l.minutes, "number", 'min="5" max="600"')}</div>` +
      field("Descrizione", "desc", l.desc, "textarea") +
      field("Link della diretta (YouTube, Zoom…)", "url", l.url, "url", 'placeholder="https://"') +
      field("Link del replay (dopo la live)", "replayUrl", l.replayUrl, "url", 'placeholder="https://"') +
      `<p class="small muted" style="margin-bottom:12px">Le dirette YouTube si vedono dentro l'app. Gli altri link (Zoom, Meet) si aprono a parte.</p>`,
      async (f) => {
        const item = { ...l, ...f, start: new Date(f.start).toISOString(), minutes: Number(f.minutes) };
        const copy = lives.slice();
        if (i >= 0) copy[i] = item; else copy.push(item);
        await saveSection("lives", copy);
      },
      i >= 0 ? async () => { const copy = lives.slice(); copy.splice(i, 1); await saveSection("lives", copy, "Eliminata"); } : null);
  };
  $("#add").onclick = () => edit(-1);
  bindList($("#adm"), lives, "lives", edit);
}

function admHome() {
  const st = S.content.settings || {}, bns = S.content.banners || [];
  $("#adm").innerHTML = `<h2 class="sec" style="margin-top:0">Benvenuto e video "Inizia da qui"</h2>
    <form class="card pad" id="setf">
      <div class="two">${field("Titolo grande", "welcomeTitle", st.welcomeTitle)}${field("Sottotitolo", "welcomeSub", st.welcomeSub)}</div>
      ${field("Titolo del video", "onboardingTitle", st.onboardingTitle)}
      ${field("Testo sotto il titolo", "onboardingText", st.onboardingText)}
      ${field("Video YouTube (link o codice)", "onboardingVideo", st.onboardingVideo, "text", 'placeholder="https://youtu.be/…"')}
      <button class="btn pri block">Salva</button>
    </form>
    <h2 class="sec">Banner a scorrimento <button id="addB">+ Nuovo</button></h2>
    <div class="card">${bns.map((b, i) => `<div class="adm-item"><span style="width:64px;height:40px;border-radius:8px;flex:none;background:var(--panel-2) center/cover;${safeUrl(b.cover) ? `background-image:url('${esc(safeUrl(b.cover))}')` : ""}"></span><div class="grow"><h4>${esc(b.title)}</h4><p class="ell">${esc(b.text)}</p></div>${itemActs(i, bns.length)}</div>`).join("") || `<div class="empty">Nessun banner</div>`}</div>`;
  $("#setf").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.onboardingVideo = ytId(f.onboardingVideo) || f.onboardingVideo;
    try { S.content = (await api("/admin/settings", f)).content; toast("Salvato"); } catch (err) { toast(err.message); }
  };
  const edit = (i) => {
    const b = i >= 0 ? bns[i] : { title: "", text: "", cover: "", link: "#/accademia" };
    formSheet(i >= 0 ? "Modifica banner" : "Nuovo banner",
      imgField("Immagine (1200 × 900 px)", "cover", b.cover, true) +
      `<p class="small muted" style="margin:-4px 0 12px">Se il testo è già nell'immagine, lascia vuoti Titolo e Testo.</p>` +
      field("Titolo (facoltativo)", "title", b.title) + field("Testo (facoltativo)", "text", b.text, "textarea") +
      select("Quando lo toccano, apre", "link", [["#/accademia", "Accademia"], ["#/live", "Calendario live"], ["#/educatori", "Educatori"], ["#/community", "Community"], ["#/notizie", "Servizio Notizie"], ["#/guadagni", "Guadagni e inviti"]], b.link),
      async (f) => { const copy = bns.slice(); if (i >= 0) copy[i] = { ...b, ...f }; else copy.push({ ...b, ...f }); await saveSection("banners", copy); },
      i >= 0 ? async () => { const copy = bns.slice(); copy.splice(i, 1); await saveSection("banners", copy, "Eliminato"); } : null);
  };
  $("#addB").onclick = () => edit(-1);
  bindList($("#adm"), bns, "banners", edit);
}

function admModules() {
  const mods = S.content.modules;
  $("#adm").innerHTML = `<button class="btn pri block" id="add">${icon("plus", "sm")}Nuovo corso</button>
    <div style="margin-top:14px">${mods.map((m, i) => `<div class="card" style="margin-bottom:10px;overflow:hidden">
      <div class="adm-item"><span class="ini" style="width:30px;height:30px;font-size:12px;border-radius:9px;background:${accColor(academyById(m.academyId))}">${i + 1}</span><div class="grow"><h4>${esc(m.title)}</h4><p>${m.lessons.length} lezioni · ${esc((academyById(m.academyId) || {}).name || "—")}${subOf(m) ? " › " + esc(subOf(m).name) : ""} · ${m.level === "premium" ? "Premium" : "Base"}</p></div>${itemActs(i, mods.length)}</div>
      ${m.lessons.map((l, j) => `<div class="sub-l">${icon("play", "sm")}<span class="grow ell">${esc(l.title)}</span>${l.youtubeId ? "" : '<span class="chip warn">no video</span>'}<button data-les="${i}.${j}" aria-label="Modifica lezione">${icon("edit", "sm")}</button></div>`).join("")}
      <div class="sub-l"><button data-les="${i}.-1" style="color:var(--blue-2);font-weight:600;display:flex;gap:6px;align-items:center">${icon("plus", "sm")}Aggiungi lezione</button></div>
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
  $("#adm").querySelectorAll("[data-les]").forEach((b) => (b.onclick = () => {
    const [i, j] = b.dataset.les.split(".").map(Number), m = mods[i];
    const l = j >= 0 ? m.lessons[j] : { title: "", youtubeId: "", minutes: "", desc: "", pdf: "" };
    const withLessons = (lessons) => mods.map((x, k) => (k === i ? { ...x, lessons } : x));
    formSheet(j >= 0 ? "Modifica lezione" : "Nuova lezione",
      field("Titolo", "title", l.title, "text", "required") +
      field("Video YouTube (link o codice)", "youtubeId", l.youtubeId, "text", 'placeholder="https://youtu.be/…"') +
      field("Durata (minuti)", "minutes", l.minutes, "number", 'min="0"') +
      field("Descrizione", "desc", l.desc, "textarea") +
      field("Link PDF (facoltativo)", "pdf", l.pdf, "text", 'placeholder="/assets/pdf/… oppure https://"') +
      (j > 0 ? `<button type="button" class="btn sec block" id="lup" style="margin-bottom:8px">${icon("up", "sm")}Sposta su</button>` : ""),
      async (f) => {
        const ls = m.lessons.slice(), item = { ...l, ...f, youtubeId: ytId(f.youtubeId) || f.youtubeId, minutes: Number(f.minutes) || 0 };
        if (j >= 0) ls[j] = item; else ls.push(item);
        await saveSection("modules", withLessons(ls));
      },
      j >= 0 ? async () => { const ls = m.lessons.slice(); ls.splice(j, 1); await saveSection("modules", withLessons(ls), "Lezione eliminata"); } : null);
    const up = $("#lup");
    if (up) up.onclick = () => { const ls = m.lessons.slice(); [ls[j - 1], ls[j]] = [ls[j], ls[j - 1]]; saveSection("modules", withLessons(ls), "Ordine aggiornato").catch((e) => toast(e.message)); };
  }));
}

function admEducators() {
  const eds = S.content.educators;
  $("#adm").innerHTML = `<button class="btn pri block" id="add">${icon("plus", "sm")}Nuovo educatore</button>
    <div class="card" style="margin-top:14px">${eds.map((e, i) => `<div class="adm-item">${face(e.name, e.photo)}<div class="grow"><h4>${esc(e.name)}</h4><p>${esc((academyById(e.academyId) || {}).name || "—")}${e.email ? " · " + esc(e.email) : ""}</p></div>${itemActs(i, eds.length)}</div>`).join("") || `<div class="empty">Nessun educatore</div>`}</div>`;
  $("#adm").querySelectorAll(".adm-item .av,.adm-item .ini").forEach((x) => (x.style.cssText = "width:40px;height:40px;font-size:13px"));
  const edit = (i) => {
    const e = i >= 0 ? eds[i] : { name: "", academyId: (S.content.academies[0] || {}).id, role: "", bio: "", photo: "", email: "" };
    formSheet(i >= 0 ? "Modifica educatore" : "Nuovo educatore",
      field("Nome e cognome", "name", e.name, "text", "required") +
      select("Accademia", "academyId", S.content.academies.map((a) => [a.id, a.name]), e.academyId) +
      field("Specialità", "role", e.role, "text", 'placeholder="Es. Acquisizione in esclusiva"') +
      field("Bio", "bio", e.bio, "textarea") +
      imgField("Foto", "photo", e.photo) +
      field("Email dell'account (per i suoi post da educatore)", "email", e.email, "email", 'placeholder="facoltativo"'),
      async (f) => { const copy = eds.slice(); if (i >= 0) copy[i] = { ...e, ...f }; else copy.push({ ...e, ...f }); await saveSection("educators", copy); },
      i >= 0 ? async () => { const copy = eds.slice(); copy.splice(i, 1); await saveSection("educators", copy, "Eliminato"); } : null);
  };
  $("#add").onclick = () => edit(-1);
  bindList($("#adm"), eds, "educators", edit);
}

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
    const { users } = await api("/admin/users");
    const draw = (t = "") => {
      const list = users.filter((u) => `${u.name} ${u.email} ${u.city}`.toLowerCase().includes(t.toLowerCase()));
      $("#ulist").innerHTML = list.map((u) => `<div class="adm-item"><div class="grow"><h4>${esc(u.name)}</h4><p>${esc(u.email)}${u.city ? " · " + esc(u.city) : ""}${u.referredBy ? " · invitato da " + esc(u.referredBy) : ""}</p></div>
        <select data-role="${esc(u.id)}">${[["agent", "Agente"], ["educator", "Educatore"], ["admin", "Admin"]].map(([v, n]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>`).join("") || `<div class="empty">Nessun utente</div>`;
      $("#ulist").querySelectorAll("[data-role]").forEach((s) => (s.onchange = async () => {
        try { await api("/admin/role", { id: s.dataset.role, role: s.value }); toast("Ruolo aggiornato"); } catch (e) { toast(e.message); }
      }));
    };
    $("#adm").innerHTML = `<div class="qs" style="grid-template-columns:1fr 1fr"><div class="card q"><b>${users.length}</b><span>Utenti</span></div><div class="card q"><b>${users.filter((u) => Date.now() - u.at < 7 * 86400000).length}</b><span>Ultimi 7 giorni</span></div></div>
      <label class="search" style="margin-top:12px">${icon("search")}<input id="uq" placeholder="Cerca per nome, email, città"></label>
      <div class="card" id="ulist" style="margin-top:12px"></div>`;
    $("#uq").oninput = (e) => draw(e.target.value);
    draw();
  } catch (e) { $("#adm").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

async function admZones() {
  $("#adm").innerHTML = `<div class="loading" style="min-height:100px"><div class="spin"></div></div>`;
  try {
    const { zones } = await api("/admin/zones");
    $("#adm").innerHTML = `<div class="card">${zones.map((z) => `<div class="adm-item"><div class="grow"><h4>${esc(z.comune)} · ${esc(z.name)}</h4><p>${esc(z.phone)} · ${esc(z.email)} · ${ago(z.at)}</p>${z.note ? `<p>${esc(z.note)}</p>` : ""}</div><a class="btn sec" href="tel:${esc(z.phone.replace(/[^\d+]/g, ""))}" style="padding:8px">${icon("phone", "sm")}</a></div>`).join("") || `<div class="empty">${icon("pin")}Nessuna richiesta ancora.</div>`}</div>`;
  } catch (e) { $("#adm").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

// ---------- avvio ----------
(function start() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref) {
    localStorage.setItem("vu_ref", ref.slice(0, 20));
    history.replaceState(null, "", location.pathname + (location.hash || "#/accedi"));
  }
  window.addEventListener("hashchange", router);
  router().then(scheduleReminders);
  // Aggiorna lo stato delle live (in diretta / passata) ogni minuto.
  setInterval(() => {
    const { name } = parseHash();
    if (S.user && name === "live" && !$("#sheet").classList.contains("open")) drawLive();
  }, 60000);
})();
