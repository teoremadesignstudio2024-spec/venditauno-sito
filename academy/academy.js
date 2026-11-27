"use strict";
// Vendita Uno Academy: libreria corsi per i clienti e pannello admin.
// I dati arrivano da /api/academy (vedi academy-api.js).

const S = { user: null, content: null, progress: { done: {}, last: "" }, adminTab: "clienti" };
const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");
const LOGO = "/assets/img/academy/logo-colonna.png";
const SITE = `${location.origin}/academy/`;

// ---------- utility ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^(https:\/\/|\/(?!\/))/.test(u || "") ? u : "");
const icon = (id, cls = "") => `<svg class="i ${cls}"><use href="#i-${id}"/></svg>`;
const initials = (n) => esc((n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase());
let toastT;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600);
}
async function api(path, body) {
  const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(`/api/academy${path}`, { credentials: "same-origin", ...opts });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== "/login") { S.user = null; location.hash = "#/accedi"; throw new Error(data.error || "Accedi per continuare"); }
  if (!res.ok) throw new Error(data.error || (res.status >= 500 ? "Il server non risponde, riprova tra poco" : "Qualcosa è andato storto"));
  return data;
}
function ytId(s) {
  const m = (s || "").match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})(?![\w-])/);
  return m ? m[1] : "";
}
// Video: Loom, YouTube, Vimeo, Google Drive o file .mp4 → indirizzo da mostrare nella pagina.
function videoSrc(url) {
  const u = (url || "").trim();
  if (!u) return null;
  const y = ytId(u);
  if (y) return { kind: "YouTube", src: `https://www.youtube-nocookie.com/embed/${y}?rel=0&modestbranding=1` };
  let m = u.match(/loom\.com\/(?:share|embed)\/([a-f0-9]{32})/i);
  if (m) return { kind: "Loom", src: `https://www.loom.com/embed/${m[1]}?hideEmbedTopBar=true` };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/i);
  if (m) return { kind: "Vimeo", src: `https://player.vimeo.com/video/${m[1]}${m[2] ? "?h=" + m[2] + "&" : "?"}title=0&byline=0` };
  m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (m) return { kind: "Google Drive", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/^https:\/\/\S+\.(mp4|webm|mov)(\?|$)/i.test(u)) return { kind: "File video", src: u, file: true };
  return null;
}
// Incollare il codice <iframe> di Loom va bene: si prende solo il link.
const linkFromEmbed = (v) => { const m = String(v || "").match(/src="([^"]+)"/); return (m ? m[1] : String(v || "")).trim(); };
function resizeImage(file, max = 1600, quality = 0.84) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => ko(new Error("Immagine non valida"));
    img.src = URL.createObjectURL(file);
  });
}

// Colore di accento: testo bianco sui colori scuri (bordeaux), scuro su quelli chiari.
function setAccent(c) {
  const v = /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#9b1c31";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  document.documentElement.style.setProperty("--acc", v);
  document.documentElement.style.setProperty("--on-acc", lum > 0.35 ? "#0a0a0a" : "#ffffff");
}
setAccent("#9b1c31");

// ---------- dati derivati ----------
const courses = () => S.content.courses;
const courseById = (id) => courses().find((c) => c.id === id);
const lessonsOf = (c) => c.modules.flatMap((m) => m.lessons);
const allLessons = () => courses().flatMap((c) => lessonsOf(c).map((l) => ({ ...l, course: c })));
const lessonById = (id) => allLessons().find((l) => l.id === id);
const isDone = (id) => !!S.progress.done[id];
function stats(c) {
  const ls = lessonsOf(c), d = ls.filter((l) => isDone(l.id)).length;
  return { all: ls.length, done: d, pct: ls.length ? Math.round((d / ls.length) * 100) : 0, next: ls.find((l) => !isDone(l.id)) || ls[0] };
}
// Dove riprendere: l'ultima lezione aperta se non è finita, altrimenti la prima non finita.
function resumeLesson() {
  const last = S.progress.last && lessonById(S.progress.last);
  if (last && !isDone(last.id)) return last;
  if (last) { const ls = lessonsOf(last.course), i = ls.findIndex((l) => l.id === last.id), n = ls.slice(i + 1).find((l) => !isDone(l.id)); if (n) return { ...n, course: last.course }; }
  return allLessons().find((l) => !isDone(l.id)) || null;
}
const ordinal = (n) => ["", "Primo", "Secondo", "Terzo", "Quarto", "Quinto", "Sesto", "Settimo", "Ottavo", "Nono", "Decimo"][n] || `${n}°`;

// Copertina: foto caricata, oppure grafica con il titolo nel riquadro di vetro.
function cover(c, small = false) {
  const u = safeUrl(c.cover);
  return `<div class="cov ${u ? "photo" : "gen"} ${small ? "sm" : ""}" style="--seed:${(c.n || 1) * 47}deg">
    ${u ? `<div class="cov-img" style="background-image:url('${esc(u)}')"></div>` : `<div class="cov-art"><b>${c.n || ""}</b></div>`}
    <div class="cov-shade"></div>
    <span class="cov-pill ${c.title.length > 34 ? "xl" : c.title.length > 18 ? "l" : ""}">${esc(c.title)}</span>
    <img class="cov-logo" src="${LOGO}" alt="">
  </div>`;
}
function thumb(l, c) {
  const u = safeUrl(l.thumb);
  return u ? `<div class="th" style="background-image:url('${esc(u)}')"></div>` : `<div class="th gen"><img src="${LOGO}" alt=""><span>${esc(l.title)}</span><small>${esc(c.title)}</small></div>`;
}
function player(url, title) {
  const v = videoSrc(url);
  if (!v) return `<div class="player empty">${icon("play")}<span>Il video di questa lezione arriva presto</span></div>`;
  if (v.file) return `<div class="player"><video src="${esc(v.src)}" controls playsinline></video></div>`;
  return `<div class="player"><iframe src="${esc(v.src)}" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
}

// ---------- finestra ----------
function openModal(title, html, onReady) {
  $("#mTitle").textContent = title;
  $("#mBody").innerHTML = html;
  $("#modal").classList.add("open");
  $("#modal").setAttribute("aria-hidden", "false");
  if (onReady) onReady($("#mBody"));
  const f = $("#mBody").querySelector("input,textarea,select");
  if (f && matchMedia("(min-width:700px)").matches) f.focus();
}
function closeModal() {
  $("#modal").classList.remove("open");
  $("#modal").setAttribute("aria-hidden", "true");
}
$("#mClose").onclick = closeModal;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
const field = (label, name, value = "", type = "text", extra = "") =>
  type === "textarea"
    ? `<label class="fld"><span>${label}</span><textarea name="${name}" rows="4" ${extra}>${esc(value)}</textarea></label>`
    : `<label class="fld"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function formModal(title, html, onSave, saveLabel = "Salva") {
  openModal(title, `<form id="mf" novalidate>${html}<div id="mErr"></div><button class="btn pri block" type="submit">${saveLabel}</button></form>`, (root) => {
    root.querySelector("#mf").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try { await onSave(Object.fromEntries(new FormData(e.target)), e.target); }
      catch (err) { $("#mErr").innerHTML = `<p class="err">${esc(err.message)}</p>`; }
      btn.disabled = false;
    };
  });
}

// ---------- router ----------
const ROUTES = {
  accedi: { fn: viewLogin, open: true },
  "": { fn: viewLibrary, nav: "lib" },
  corso: { fn: viewCourse, nav: "lib" },
  lezione: { fn: viewLesson, nav: "lib" },
  cerca: { fn: viewSearch, nav: "cerca" },
  profilo: { fn: viewProfile, nav: "" },
  admin: { fn: viewAdmin, nav: "admin", admin: true },
};
function parseHash() {
  const [p, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const [name, ...args] = p.split("/");
  return { name, args: args.map(decodeURIComponent), q: new URLSearchParams(qs || "") };
}
async function loadMe() {
  try {
    const d = await api("/me");
    Object.assign(S, { user: d.user, content: d.content, progress: d.progress || { done: {}, last: "" } });
    setAccent(d.content.settings.accent);
    return true;
  } catch { return false; }
}
async function router() {
  closeModal();
  const { name, args, q } = parseHash();
  const r = ROUTES[name] || ROUTES[""];
  if (!r.open && !S.user && !(await loadMe())) { if (name !== "accedi") { location.hash = "#/accedi"; return; } }
  if (name === "accedi" && (S.user || (await loadMe()))) { location.hash = "#/"; return; }
  if (r.admin && S.user.role !== "admin") { location.hash = "#/"; return; }
  $("#top").hidden = !!r.open;
  document.body.classList.toggle("auth", !!r.open);
  if (!r.open) {
    $("#me").innerHTML = `<span class="av">${initials(S.user.name)}</span>`;
    $("#navAdmin").hidden = S.user.role !== "admin";
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.nav));
  }
  window.scrollTo(0, 0);
  await r.fn(args, q);
}
window.addEventListener("hashchange", router);

// =====================================================================
// ACCESSO
// =====================================================================
async function viewLogin() {
  let setup = false;
  try { setup = (await api("/setup")).needed; } catch {}
  view.innerHTML = `
    <section class="login">
      <div class="lg-glow"></div>
      <div class="lg-card">
        <img class="lg-logo" src="${LOGO}" alt="">
        <p class="lg-k">Vendita Uno</p>
        <h1>Academy</h1>
        <p class="lg-sub">${setup ? "Prima attivazione: crea l'account amministratore con il codice che hai ricevuto." : "La formazione per costruire un'agenzia immobiliare che vende. Accedi con le credenziali che ti abbiamo dato."}</p>
        <form id="lf" novalidate>
          ${setup ? field("Codice di attivazione", "code", "", "text", 'required autocomplete="off" autocapitalize="characters"') + field("Il tuo nome", "name", "", "text", 'required autocomplete="name"') : ""}
          ${field("Username", "username", "", "text", 'required autocomplete="username" autocapitalize="none" spellcheck="false"')}
          ${field("Password", "password", "", "password", `required autocomplete="${setup ? "new-password" : "current-password"}"`)}
          <div id="lErr"></div>
          <button class="btn pri block" type="submit">${setup ? "Attiva l'Academy" : "Accedi all'area membri"}${icon("chev")}</button>
        </form>
        <p class="lg-foot">Non hai le credenziali? Scrivi a Vendita Uno.</p>
      </div>
    </section>`;
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api(setup ? "/setup" : "/login", Object.fromEntries(new FormData(e.target)));
      await loadMe();
      location.hash = setup ? "#/admin" : "#/";
    } catch (err) { $("#lErr").innerHTML = `<p class="err">${esc(err.message)}</p>`; btn.disabled = false; }
  };
}

// =====================================================================
// LIBRERIA
// =====================================================================
function courseCard(c) {
  const st = stats(c);
  const cta = !st.all ? "Lezioni in arrivo" : st.pct === 100 ? "Rivedi il corso" : st.done ? "Continua il corso" : "Inizia subito il corso";
  return `<a class="card" href="#/corso/${esc(c.id)}">
    ${cover(c)}
    <div class="card-b">
      <h3>${esc(c.title)}</h3>
      <div class="bar"><i style="width:${st.pct}%"></i></div>
      <p class="card-meta">${st.all ? `${st.done} di ${st.all} ${st.all === 1 ? "lezione" : "lezioni"}` : "In preparazione"}${st.pct === 100 ? " · completato" : ""}</p>
      <p class="card-d">${esc(c.desc)}</p>
      <span class="btn out block ${st.all ? "" : "dim"}">${cta} »</span>
    </div>
  </a>`;
}
function viewLibrary() {
  const s = S.content.settings, r = resumeLesson(), cs = courses();
  view.innerHTML = `
    <section class="hero">
      <div class="hero-card">
        <h1>${esc(s.heroTitle || "La tua libreria corsi")}</h1>
        <p>${esc(s.heroText || "")}</p>
        ${r ? `<a class="btn out" href="#/lezione/${esc(r.id)}">Riprendi da dove hai lasciato</a>` : ""}
      </div>
      <div class="hero-art" aria-hidden="true"><div class="ha-glow"></div><img src="${LOGO}" alt=""><span>${cs.length} corsi · ${allLessons().length} lezioni</span></div>
    </section>
    ${r ? `<section class="resume">
      <h2>Riprendi da dove hai lasciato »</h2>
      <a class="rs-card" href="#/lezione/${esc(r.id)}">
        <div class="rs-tx"><small>Riprendi</small><b>${esc(r.course.title)}</b><span>${esc(r.title)}</span></div>
        <div class="rs-th">${thumb(r, r.course)}<span class="rs-play">${icon("play")}</span></div>
      </a>
    </section>` : ""}
    <section class="lib">
      ${cs.length ? `<div class="grid">${cs.map(courseCard).join("")}</div>` : `<div class="empty">${icon("lock")}<p>Non hai ancora corsi attivi. Contatta Vendita Uno per sbloccarli.</p></div>`}
    </section>`;
}

// =====================================================================
// CORSO
// =====================================================================
function viewCourse([id]) {
  const c = courseById(id);
  if (!c) { location.hash = "#/"; return; }
  const st = stats(c), u = safeUrl(c.cover);
  view.innerHTML = `
    <section class="c-hero">
      <div class="c-bg ${u ? "" : "gen"}" ${u ? `style="background-image:url('${esc(u)}')"` : `style="--seed:${c.n * 47}deg"`}></div>
      <div class="c-in">
        <a class="back" href="#/">${icon("back")}La tua libreria corsi</a>
        <p class="c-k">${ordinal(c.n)} corso</p>
        <h1>${esc(c.title)}</h1>
        <p class="c-d">${esc(c.desc)}</p>
        ${st.all ? `<a class="btn pri" href="#/lezione/${esc(st.next.id)}">${st.done ? (st.pct === 100 ? "Rivedi il corso" : "Riprendi il corso") : "Inizia il corso"}</a>` : `<span class="btn out dim">Lezioni in arrivo</span>`}
      </div>
    </section>
    <section class="c-body">
      <div class="c-main">
        ${c.modules.filter((m) => m.lessons.length).map((m) => `<div class="mod">
          <h2>${esc(m.title)}</h2>
          ${m.lessons.map((l) => `<a class="les ${isDone(l.id) ? "done" : ""}" href="#/lezione/${esc(l.id)}">${thumb(l, c)}<span class="les-t">${esc(l.title)}</span><span class="les-ck">${isDone(l.id) ? icon("check") : icon("play")}</span></a>`).join("")}
        </div>`).join("") || `<div class="mod"><h2>Lezioni in arrivo</h2><p class="muted">Stiamo preparando le lezioni di questo corso. Le troverai qui appena pronte.</p></div>`}
      </div>
      <aside class="c-side">
        <div class="side-card">
          <p><b>${st.done}</b> di ${st.all} lezioni completate</p>
          <div class="bar"><i style="width:${st.pct}%"></i></div>
          ${st.pct === 100 ? `<p class="ok">${icon("check")}Corso completato</p>` : ""}
        </div>
      </aside>
    </section>`;
}

// =====================================================================
// LEZIONE
// =====================================================================
function viewLesson([id]) {
  const l = lessonById(id);
  if (!l) { location.hash = "#/"; return; }
  const c = l.course, ls = lessonsOf(c), i = ls.findIndex((x) => x.id === id), prev = ls[i - 1], next = ls[i + 1];
  api("/progress", { lessonId: id, open: true }).then((d) => (S.progress = d.progress)).catch(() => {});
  const draw = () => {
    const done = isDone(id), st = stats(c);
    view.innerHTML = `
      <section class="l-wrap">
        <div class="l-main">
          <a class="back" href="#/corso/${esc(c.id)}">${icon("back")}${esc(c.title)}</a>
          ${player(l.video, l.title)}
          <p class="l-k">Lezione ${i + 1} di ${ls.length}</p>
          <h1>${esc(l.title)}</h1>
          ${l.desc ? `<p class="l-d">${esc(l.desc)}</p>` : ""}
          ${safeUrl(l.pdf) ? `<a class="file" href="${esc(safeUrl(l.pdf))}" target="_blank" rel="noopener">${icon("doc")}<span>Materiale della lezione</span>${icon("chev")}</a>` : ""}
          <div class="l-act">
            <button class="btn ${done ? "ok" : "pri"}" id="done">${icon("check")}${done ? "Completata" : "Segna come completata"}</button>
            <div class="l-nav">
              ${prev ? `<a class="btn ghost" href="#/lezione/${esc(prev.id)}">${icon("back")}Precedente</a>` : ""}
              ${next ? `<a class="btn ghost" href="#/lezione/${esc(next.id)}">Successiva${icon("chev")}</a>` : ""}
            </div>
          </div>
        </div>
        <aside class="l-side">
          <div class="side-card">
            <p><b>${st.done}</b> di ${st.all} lezioni completate</p>
            <div class="bar"><i style="width:${st.pct}%"></i></div>
          </div>
          <div class="l-list">${ls.map((x, k) => `<a class="ll ${x.id === id ? "on" : ""} ${isDone(x.id) ? "done" : ""}" href="#/lezione/${esc(x.id)}"><span class="ll-n">${isDone(x.id) ? icon("check") : k + 1}</span><span>${esc(x.title)}</span></a>`).join("")}</div>
        </aside>
      </section>`;
    $("#done").onclick = async () => {
      try {
        S.progress = (await api("/progress", { lessonId: id, done: !done })).progress;
        if (!done && next) { toast("Lezione completata"); location.hash = `#/lezione/${next.id}`; }
        else { toast(done ? "Segnata come da rivedere" : stats(c).pct === 100 ? "Hai completato il corso" : "Lezione completata"); draw(); }
      } catch (e) { toast(e.message); }
    };
  };
  draw();
}

// =====================================================================
// CERCA
// =====================================================================
function viewSearch(_, q) {
  view.innerHTML = `<section class="page">
    <h1 class="pg-t">Cerca</h1>
    <label class="search">${icon("search")}<input id="sq" placeholder="Cerca un corso o una lezione…" autocomplete="off" value="${esc(q.get("q") || "")}"></label>
    <div id="sr"></div></section>`;
  const run = () => {
    const t = $("#sq").value.trim().toLowerCase();
    const cs = courses().filter((c) => !t || `${c.title} ${c.desc}`.toLowerCase().includes(t));
    const ls = t ? allLessons().filter((l) => `${l.title} ${l.desc}`.toLowerCase().includes(t)) : [];
    $("#sr").innerHTML = `${cs.length ? `<h2 class="sr-h">Corsi</h2><div class="sr-list">${cs.map((c) => `<a class="sr" href="#/corso/${esc(c.id)}">${cover(c, true)}<span><b>${esc(c.title)}</b><small>${stats(c).all} lezioni</small></span>${icon("chev")}</a>`).join("")}</div>` : ""}
      ${ls.length ? `<h2 class="sr-h">Lezioni</h2><div class="sr-list">${ls.map((l) => `<a class="sr" href="#/lezione/${esc(l.id)}">${thumb(l, l.course)}<span><b>${esc(l.title)}</b><small>${esc(l.course.title)}</small></span>${icon("chev")}</a>`).join("")}</div>` : ""}
      ${t && !cs.length && !ls.length ? `<div class="empty">${icon("search")}<p>Nessun risultato per "${esc(t)}".</p></div>` : ""}`;
  };
  $("#sq").oninput = run;
  run();
  $("#sq").focus();
}

// =====================================================================
// PROFILO
// =====================================================================
function viewProfile() {
  const u = S.user;
  view.innerHTML = `<section class="page narrow">
    <div class="prof"><span class="av big">${initials(u.name)}</span><div><h1 class="pg-t">${esc(u.name)}</h1><p class="muted">Username: ${esc(u.username)}${u.role === "admin" ? " · Amministratore" : ""}</p></div></div>
    <form class="panel" id="pw">
      <h2>Cambia password</h2>
      ${field("Password attuale", "old", "", "password", 'autocomplete="current-password"')}
      ${field("Nuova password (almeno 8 caratteri)", "password", "", "password", 'autocomplete="new-password"')}
      <div id="pErr"></div>
      <button class="btn pri">Cambia password</button>
    </form>
    <button class="btn ghost block" id="out">${icon("logout")}Esci</button>
  </section>`;
  $("#pw").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/password", Object.fromEntries(new FormData(e.target))); e.target.reset(); $("#pErr").innerHTML = ""; toast("Password cambiata"); }
    catch (err) { $("#pErr").innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  };
  $("#out").onclick = async () => { try { await api("/logout", {}); } catch {} S.user = null; location.hash = "#/accedi"; };
}

// =====================================================================
// ADMIN
// =====================================================================
async function viewAdmin() {
  const tabs = [["clienti", "Clienti"], ["corsi", "Corsi e lezioni"], ["aspetto", "Aspetto"]];
  view.innerHTML = `<section class="page">
    <h1 class="pg-t">Pannello admin</h1>
    <div class="tabs">${tabs.map(([k, n]) => `<button data-t="${k}" class="${S.adminTab === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div id="adm"><div class="loading"><div class="spin"></div></div></div></section>`;
  view.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { S.adminTab = b.dataset.t; viewAdmin(); }));
  // L'admin vede sempre i contenuti completi
  ({ clienti: admClients, corsi: admCourses, aspetto: admLook })[S.adminTab]();
}
const genPassword = () => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => a[x % a.length]).join(""); };
const credText = (u, p) => `Vendita Uno Academy\nLink: ${SITE}\nUsername: ${u}\nPassword: ${p}`;
function accessPicker(access) {
  const all = access === "all" || access === undefined;
  return `<div class="fld"><span>Corsi che può vedere</span>
    <label class="chk"><input type="radio" name="accMode" value="all" ${all ? "checked" : ""}> Tutti i corsi (anche quelli che aggiungerai)</label>
    <label class="chk"><input type="radio" name="accMode" value="some" ${all ? "" : "checked"}> Solo questi:</label>
    <div class="acc-list">${courses().map((c) => `<label class="chk sub"><input type="checkbox" name="acc" value="${esc(c.id)}" ${!all && access.includes(c.id) ? "checked" : ""}> ${c.n}. ${esc(c.title)}</label>`).join("")}</div></div>`;
}
const readAccess = (form) => (form.querySelector("[name=accMode]:checked").value === "all" ? "all" : [...form.querySelectorAll("[name=acc]:checked")].map((i) => i.value));
function showCreds(username, password) {
  openModal("Credenziali del cliente", `<p class="muted" style="margin-bottom:14px">Mandale al cliente. La password non si potrà rivedere: se la perde, ne crei una nuova.</p>
    <pre class="creds">${esc(credText(username, password))}</pre>
    <button class="btn pri block" id="cp">${icon("copy")}Copia credenziali</button>`, (root) => {
    root.querySelector("#cp").onclick = async () => { try { await navigator.clipboard.writeText(credText(username, password)); toast("Credenziali copiate"); } catch { toast("Seleziona il testo e copialo"); } };
  });
}
async function admClients() {
  let users;
  try { users = (await api("/admin/users")).users; } catch (e) { $("#adm").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const clients = users.filter((u) => u.role !== "admin"), admins = users.filter((u) => u.role === "admin");
  const fmt = (t) => (t ? new Date(t).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" }) : "mai");
  const row = (u) => `<div class="urow ${u.blocked ? "blocked" : ""}">
    <span class="av">${initials(u.name)}</span>
    <div class="u-main"><b>${esc(u.name)}${u.blocked ? ' <em class="tag">sospeso</em>' : ""}${u.role === "admin" ? ' <em class="tag acc">admin</em>' : ""}</b>
      <small>${esc(u.username)} · ultimo accesso: ${fmt(u.lastLogin)} · ${u.access === "all" ? "tutti i corsi" : `${(u.access || []).length} corsi`}</small></div>
    <div class="u-prog"><div class="bar"><i style="width:${u.lessons ? Math.round((u.done / u.lessons) * 100) : 0}%"></i></div><small>${u.done}/${u.lessons}</small></div>
    <div class="u-act"><button data-ed="${esc(u.username)}" aria-label="Modifica">${icon("edit")}</button>${u.username !== S.user.username ? `<button data-del="${esc(u.username)}" aria-label="Elimina">${icon("trash")}</button>` : ""}</div>
  </div>`;
  $("#adm").innerHTML = `
    <div class="adm-hd"><div><h2>Clienti</h2><p class="muted">${clients.length} ${clients.length === 1 ? "cliente" : "clienti"}. Crei tu username e password: nessuno può iscriversi da solo.</p></div><button class="btn pri" id="addU">${icon("plus")}Nuovo cliente</button></div>
    <label class="search">${icon("search")}<input id="uq" placeholder="Cerca per nome o username"></label>
    <div class="panel list" id="ulist">${clients.map(row).join("") || `<div class="empty">${icon("user")}<p>Nessun cliente ancora. Crea il primo con "Nuovo cliente".</p></div>`}</div>
    <h2 class="sub-h">Amministratori</h2><div class="panel list">${admins.map(row).join("")}</div>`;
  $("#uq").oninput = (e) => { const t = e.target.value.toLowerCase(); $("#ulist").querySelectorAll(".urow").forEach((r) => (r.hidden = !r.textContent.toLowerCase().includes(t))); };
  $("#addU").onclick = () => {
    const pw = genPassword();
    formModal("Nuovo cliente",
      field("Nome e cognome", "name", "", "text", 'required') +
      field("Username (senza spazi, es. mario.rossi oppure la sua email)", "username", "", "text", 'required autocapitalize="none" spellcheck="false"') +
      `<div class="pw-row">${field("Password", "password", pw, "text", 'required autocomplete="off"')}<button type="button" class="btn ghost" id="gp" aria-label="Genera password">${icon("dice")}</button></div>` +
      accessPicker("all"),
      async (f, form) => {
        await api("/admin/user", { create: true, name: f.name, username: f.username, password: f.password, access: readAccess(form) });
        showCreds(f.username.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ""), f.password);
        admClients();
      }, "Crea cliente");
    const nm = $("#mf [name=name]"), un = $("#mf [name=username]");
    nm.oninput = () => { if (!un.dataset.touched) un.value = nm.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, ""); };
    un.oninput = () => (un.dataset.touched = "1");
    $("#gp").onclick = () => ($("#mf [name=password]").value = genPassword());
  };
  $("#adm").querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => {
    const u = users.find((x) => x.username === b.dataset.ed), self = u.username === S.user.username;
    formModal(`Modifica ${u.name}`,
      field("Nome e cognome", "name", u.name, "text", "required") +
      `<p class="muted small" style="margin:-4px 0 14px">Username: <b>${esc(u.username)}</b></p>` +
      `<div class="pw-row">${field("Nuova password (lascia vuoto per non cambiarla)", "password", "", "text", 'autocomplete="off"')}<button type="button" class="btn ghost" id="gp" aria-label="Genera password">${icon("dice")}</button></div>` +
      (u.role === "admin" ? "" : accessPicker(u.access)) +
      (self ? "" : `<label class="chk"><input type="checkbox" name="blocked" ${u.blocked ? "checked" : ""}> Accesso sospeso (non può entrare)</label>
        <label class="chk"><input type="checkbox" name="admin" ${u.role === "admin" ? "checked" : ""}> È un amministratore</label>`),
      async (f, form) => {
        const body = { username: u.username, name: f.name };
        if (u.role !== "admin") body.access = readAccess(form);
        if (!self) { body.blocked = !!f.blocked; body.role = f.admin ? "admin" : "client"; }
        if (f.password) body.password = f.password;
        await api("/admin/user", body);
        if (f.password) showCreds(u.username, f.password); else { closeModal(); toast("Salvato"); }
        admClients();
      });
    $("#gp").onclick = () => ($("#mf [name=password]").value = genPassword());
  }));
  $("#adm").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Eliminare ${b.dataset.del}? Perde l'accesso e i suoi progressi.`)) return;
    try { await api("/admin/user/delete", { username: b.dataset.del }); toast("Cliente eliminato"); admClients(); } catch (e) { toast(e.message); }
  }));
}

// ---- corsi, moduli e lezioni ----
async function saveCourses(list, msg = "Salvato") {
  const d = await api("/admin/content", { courses: list });
  S.content = { settings: d.content.settings, courses: d.content.courses };
  toast(msg);
}
const clone = () => JSON.parse(JSON.stringify(courses()));
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
const newId = () => Math.random().toString(16).slice(2, 10);
function imgPicker(label, name, value) {
  return `<div class="fld"><span>${label}</span><div class="imgp">
    <div class="imgp-prev" ${safeUrl(value) ? `style="background-image:url('${esc(value)}')"` : ""}>${safeUrl(value) ? "" : icon("image")}</div>
    <div><label class="btn ghost">${icon("image")}Carica immagine<input type="file" accept="image/*" hidden data-img="${name}"></label>
    ${safeUrl(value) ? `<button type="button" class="btn ghost" data-noimg="${name}">Togli</button>` : ""}</div>
    <input type="hidden" name="${name}" value="${esc(value)}"></div></div>`;
}
function bindImg(root) {
  root.querySelectorAll("[data-img]").forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    toast("Carico l'immagine…");
    try {
      const { url } = await api("/admin/image", { dataUrl: await resizeImage(f) });
      root.querySelector(`[name=${inp.dataset.img}]`).value = url;
      const pv = inp.closest(".imgp").querySelector(".imgp-prev");
      pv.style.backgroundImage = `url('${url}')`; pv.innerHTML = "";
      toast("Immagine caricata: ricordati di salvare");
    } catch (e) { toast(e.message); }
  }));
  root.querySelectorAll("[data-noimg]").forEach((b) => (b.onclick = () => {
    root.querySelector(`[name=${b.dataset.noimg}]`).value = "";
    const pv = b.closest(".imgp").querySelector(".imgp-prev"); pv.style.backgroundImage = ""; pv.innerHTML = icon("image"); b.remove();
  }));
}
function admCourses() {
  const cs = courses();
  $("#adm").innerHTML = `
    <div class="adm-hd"><div><h2>Corsi e lezioni</h2><p class="muted">I corsi compaiono nella libreria in quest'ordine. Dentro ogni corso: moduli e lezioni.</p></div><button class="btn pri" id="addC">${icon("plus")}Nuovo corso</button></div>
    ${cs.map((c, i) => `<div class="panel ac">
      <div class="ac-hd">${cover(c, true)}<div class="grow"><b>${c.n}. ${esc(c.title)}</b><small>${c.modules.length} ${c.modules.length === 1 ? "modulo" : "moduli"} · ${lessonsOf(c).length} lezioni</small></div>
        <div class="u-act">${i ? `<button data-cu="${i}" aria-label="Sposta su">${icon("up")}</button>` : ""}${i < cs.length - 1 ? `<button data-cd="${i}" aria-label="Sposta giù">${icon("down")}</button>` : ""}<button data-ce="${i}" aria-label="Modifica corso">${icon("edit")}</button><button data-cx="${i}" aria-label="Elimina corso">${icon("trash")}</button></div></div>
      ${c.modules.map((m, j) => `<div class="am">
        <div class="am-hd"><b>${esc(m.title)}</b><div class="u-act">${j ? `<button data-mu="${i}.${j}" aria-label="Sposta su">${icon("up")}</button>` : ""}<button data-me="${i}.${j}" aria-label="Rinomina modulo">${icon("edit")}</button><button data-mx="${i}.${j}" aria-label="Elimina modulo">${icon("trash")}</button></div></div>
        ${m.lessons.map((l, k) => `<div class="al"><span class="al-n">${k + 1}</span><span class="grow ell">${esc(l.title)}</span>${videoSrc(l.video) ? `<em class="tag">${videoSrc(l.video).kind}</em>` : '<em class="tag warn">senza video</em>'}
          <div class="u-act">${k ? `<button data-lu="${i}.${j}.${k}" aria-label="Sposta su">${icon("up")}</button>` : ""}<button data-le="${i}.${j}.${k}" aria-label="Modifica lezione">${icon("edit")}</button><button data-lx="${i}.${j}.${k}" aria-label="Elimina lezione">${icon("trash")}</button></div></div>`).join("")}
        <div class="am-add"><button data-le="${i}.${j}.-1">${icon("plus")}Lezione</button><button data-lb="${i}.${j}">${icon("plus")}Più lezioni insieme</button></div>
      </div>`).join("")}
      <div class="am-add top"><button data-ma="${i}">${icon("plus")}Nuovo modulo</button></div>
    </div>`).join("") || `<div class="empty">${icon("doc")}<p>Nessun corso. Crea il primo.</p></div>`}`;
  const A = $("#adm"), on = (sel, fn) => A.querySelectorAll(`[${sel}]`).forEach((b) => (b.onclick = () => fn(...b.getAttribute(sel).split(".").map(Number))));
  const save = async (list, msg) => { try { await saveCourses(list, msg); admCourses(); } catch (e) { toast(e.message); } };
  const editCourse = (i) => {
    const c = i >= 0 ? cs[i] : { title: "", desc: "", cover: "", modules: [{ id: newId(), title: "Lezioni", lessons: [] }] };
    formModal(i >= 0 ? "Modifica corso" : "Nuovo corso",
      field("Titolo", "title", c.title, "text", "required") + field("Descrizione (compare sotto la copertina e nella pagina del corso)", "desc", c.desc, "textarea") +
      imgPicker("Copertina (orizzontale, 1600 × 900 px). Se manca, la creiamo noi col titolo", "cover", c.cover),
      async (f) => {
        if (!f.title.trim()) throw new Error("Scrivi il titolo del corso");
        const list = clone();
        if (i >= 0) Object.assign(list[i], { title: f.title, desc: f.desc, cover: f.cover }); else list.push({ ...c, id: newId(), title: f.title, desc: f.desc, cover: f.cover });
        await saveCourses(list, i >= 0 ? "Corso salvato" : "Corso creato"); closeModal(); admCourses();
      });
    bindImg($("#mBody"));
  };
  $("#addC").onclick = () => editCourse(-1);
  on("data-ce", editCourse);
  on("data-cu", (i) => { const l = clone(); move(l, i, -1); save(l, "Ordine aggiornato"); });
  on("data-cd", (i) => { const l = clone(); move(l, i, 1); save(l, "Ordine aggiornato"); });
  on("data-cx", (i) => { if (!confirm(`Eliminare il corso "${cs[i].title}" con tutte le sue lezioni?`)) return; const l = clone(); l.splice(i, 1); save(l, "Corso eliminato"); });
  on("data-ma", (i) => formModal("Nuovo modulo", field("Titolo del modulo (es. I principi della vendita)", "title", "", "text", "required"), async (f) => { const l = clone(); l[i].modules.push({ id: newId(), title: f.title || "Modulo", lessons: [] }); await saveCourses(l, "Modulo creato"); closeModal(); admCourses(); }));
  on("data-me", (i, j) => formModal("Rinomina modulo", field("Titolo del modulo", "title", cs[i].modules[j].title, "text", "required"), async (f) => { const l = clone(); l[i].modules[j].title = f.title; await saveCourses(l); closeModal(); admCourses(); }));
  on("data-mu", (i, j) => { const l = clone(); move(l[i].modules, j, -1); save(l, "Ordine aggiornato"); });
  on("data-mx", (i, j) => { if (!confirm(`Eliminare il modulo "${cs[i].modules[j].title}" e le sue lezioni?`)) return; const l = clone(); l[i].modules.splice(j, 1); save(l, "Modulo eliminato"); });
  on("data-lu", (i, j, k) => { const l = clone(); move(l[i].modules[j].lessons, k, -1); save(l, "Ordine aggiornato"); });
  on("data-lx", (i, j, k) => { if (!confirm(`Eliminare la lezione "${cs[i].modules[j].lessons[k].title}"?`)) return; const l = clone(); l[i].modules[j].lessons.splice(k, 1); save(l, "Lezione eliminata"); });
  on("data-le", (i, j, k) => {
    const les = k >= 0 ? cs[i].modules[j].lessons[k] : { title: "", video: "", desc: "", pdf: "", thumb: "" };
    formModal(k >= 0 ? "Modifica lezione" : "Nuova lezione",
      field("Titolo", "title", les.title, "text", "required") +
      field("Video: link o codice da incorporare (Loom, YouTube, Vimeo, Google Drive)", "video", les.video, "text", 'placeholder="https://www.loom.com/share/…"') +
      `<p class="muted small" id="vk" style="margin:-6px 0 14px"></p>` +
      field("Descrizione (facoltativa)", "desc", les.desc, "textarea") +
      field("Link PDF o materiale (facoltativo)", "pdf", les.pdf, "text", 'placeholder="https://…"') +
      imgPicker("Miniatura (facoltativa). Se manca, la creiamo noi", "thumb", les.thumb),
      async (f) => {
        if (!f.title.trim()) throw new Error("Scrivi il titolo della lezione");
        const video = linkFromEmbed(f.video);
        if (video && !videoSrc(video)) throw new Error("Link video non riconosciuto: usa un link Loom, YouTube, Vimeo o Google Drive");
        const l = clone(), item = { ...les, id: les.id || newId(), title: f.title, video, desc: f.desc, pdf: f.pdf.trim(), thumb: f.thumb };
        if (k >= 0) l[i].modules[j].lessons[k] = item; else l[i].modules[j].lessons.push(item);
        await saveCourses(l, k >= 0 ? "Lezione salvata" : "Lezione aggiunta"); closeModal(); admCourses();
      });
    bindImg($("#mBody"));
    const vin = $("#mf [name=video]"), vk = $("#vk");
    const show = () => { const v = videoSrc(linkFromEmbed(vin.value)); vk.textContent = vin.value.trim() ? (v ? `✓ Video ${v.kind} riconosciuto` : "Link non riconosciuto") : ""; vk.className = `small ${v ? "okt" : "warnt"}`; };
    vin.oninput = show; show();
  });
  on("data-lb", (i, j) => formModal(`Più lezioni in "${cs[i].modules[j].title}"`,
    `<p class="muted small" style="margin-bottom:12px">Una lezione per riga: <b>Titolo | link del video</b>.</p>` + field("Lezioni", "lines", "", "textarea", 'rows="8" placeholder="Cosa è la vendita | https://www.loom.com/share/…\nI 3 pilastri della vendita | https://www.loom.com/share/…"'),
    async (f) => {
      const rows = f.lines.split("\n").map((r) => r.trim()).filter(Boolean);
      if (!rows.length) throw new Error("Scrivi almeno una lezione");
      const bad = [], add = rows.map((r, n) => { const [t, v = ""] = r.split("|").map((x) => x.trim()); const video = linkFromEmbed(v); if (video && !videoSrc(video)) bad.push(n + 1); return { id: newId(), title: t || `Lezione ${n + 1}`, video, desc: "", pdf: "", thumb: "" }; });
      if (bad.length) throw new Error(`Link non riconosciuto alla riga ${bad.join(", ")}`);
      const l = clone(); l[i].modules[j].lessons.push(...add);
      await saveCourses(l, `${add.length} lezioni aggiunte`); closeModal(); admCourses();
    }));
}
function admLook() {
  const s = S.content.settings;
  const swatches = ["#9b1c31", "#7a1426", "#b8323f", "#c9a24a", "#22e04a", "#2f6bff", "#ffffff"];
  $("#adm").innerHTML = `<form class="panel" id="lk">
    <h2>Aspetto della libreria</h2>
    ${field("Titolo in alto", "heroTitle", s.heroTitle)}
    ${field("Testo sotto il titolo", "heroText", s.heroText, "textarea")}
    <div class="fld"><span>Colore di accento</span><div class="sw">${swatches.map((c) => `<button type="button" data-c="${c}" style="--c:${c}" class="${c === s.accent ? "on" : ""}" aria-label="${c}"></button>`).join("")}<input type="color" name="accent" value="${esc(s.accent)}" aria-label="Colore personalizzato"></div></div>
    <button class="btn pri">Salva</button></form>`;
  const inp = $("#lk [name=accent]");
  const paint = (c) => { inp.value = c; setAccent(c); $("#lk").querySelectorAll("[data-c]").forEach((b) => b.classList.toggle("on", b.dataset.c === c)); };
  $("#lk").querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => paint(b.dataset.c)));
  inp.oninput = () => paint(inp.value);
  $("#lk").onsubmit = async (e) => {
    e.preventDefault();
    try { const d = await api("/admin/content", { settings: Object.fromEntries(new FormData(e.target)) }); S.content.settings = d.content.settings; toast("Salvato"); } catch (err) { toast(err.message); }
  };
}

// ---------- avvio ----------
router();
