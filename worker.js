import usersData from "./academy-users.json";

const VIDEOS = [
  { id: "v1", youtubeId: "jqOjebgNQvk", title: "Modulo 1 — Introduzione al metodo" },
  { id: "v2", youtubeId: "jqOjebgNQvk", title: "Modulo 2 — Acquisizione mandati" },
  { id: "v3", youtubeId: "jqOjebgNQvk", title: "Modulo 3 — Chiusura e firma" },
];

const COOKIE_NAME = "vu_academy_session";
// TODO: spostare questa stringa in un Cloudflare Secret reale (wrangler secret put SESSION_SECRET)
// invece di tenerla nel codice, appena possibile per maggiore sicurezza.
const SESSION_SECRET = "vendita-uno-academy-temp-secret-change-me-2026";
const SESSION_DAYS = 14;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return toHex(buf);
}

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

async function makeSessionToken(username) {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${username}.${expiry}`;
  const sig = await hmacHex(payload, SESSION_SECRET);
  return btoa(`${payload}.${sig}`);
}

async function verifySessionToken(token) {
  try {
    const decoded = atob(token);
    const [username, expiry, sig] = decoded.split(".");
    const expectedSig = await hmacHex(`${username}.${expiry}`, SESSION_SECRET);
    if (sig !== expectedSig) return null;
    if (Date.now() > parseInt(expiry, 10)) return null;
    return username;
  } catch (e) {
    return null;
  }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function getSessionUser(request) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return null;
  return verifySessionToken(token);
}

async function checkPassword(username, password) {
  const user = usersData.users.find((u) => u.username === username);
  if (!user) return false;
  const hash = await sha256Hex(user.salt + password);
  return hash === user.hash;
}

function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#030712">
<meta name="robots" content="noindex">
<title>${title} — VenditaUno Academy</title>
<link rel="icon" type="image/png" href="/assets/img/logo.png">
<link rel="stylesheet" href="/assets/style.css">
<style>
.academy-wrap { max-width: 720px; margin: 0 auto; padding: 80px 24px; }
.login-box { max-width: 380px; margin: 60px auto; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 36px; }
.login-box input { width: 100%; padding: 12px 14px; margin-bottom: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--muted); color: var(--foreground); font-size: 1rem; }
.login-box label { font-size: 0.85rem; color: var(--muted-foreground); display: block; margin-bottom: 6px; }
.error-msg { color: #f87171; font-size: 0.9rem; margin-bottom: 14px; text-align: center; }
.video-item { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 20px; }
.video-item iframe { width: 100%; aspect-ratio: 16/9; border: none; border-radius: var(--radius); }
.video-item h3 { margin: 14px 0 10px; }
.complete-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: var(--radius); border: 1px solid var(--border); font-weight: 700; font-size: 0.9rem; cursor: pointer; background: var(--muted); color: var(--foreground); }
.complete-btn.done { background: rgba(34,197,94,0.15); border-color: rgba(34,197,94,0.4); color: #4ade80; }
</style>
</head>
<body style="background:var(--background);">
<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo"><img src="/assets/img/logo.png" alt="Vendita Uno" class="nav-logo-img"></a>
  </div>
</nav>
${bodyHtml}
</body>
</html>`;
}

function loginPage(error) {
  return pageShell("Accedi", `
  <div class="academy-wrap">
    <div class="login-box">
      <div class="eyebrow money" style="justify-content:center;display:flex;">🎓 VenditaUno Academy</div>
      <h1 style="text-align:center;font-size:1.6rem;margin:14px 0 24px;">Accedi</h1>
      ${error ? `<p class="error-msg">${error}</p>` : ""}
      <form method="POST" action="/academy">
        <label>Username</label>
        <input type="text" name="username" required autocomplete="username">
        <label>Password</label>
        <input type="password" name="password" required autocomplete="current-password">
        <button type="submit" class="btn btn-money btn-block btn-lg">Accedi</button>
      </form>
    </div>
  </div>`);
}

async function academyPage(username, env, request) {
  const kv = env.ACADEMY_PROGRESS;
  let completed = {};
  if (kv) {
    const raw = await kv.get(`progress:${username}`);
    if (raw) completed = JSON.parse(raw);
  }
  const videosHtml = VIDEOS.map((v) => `
    <div class="video-item">
      <iframe src="https://www.youtube.com/embed/${v.youtubeId}" title="${v.title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
      <h3>${v.title}</h3>
      <button class="complete-btn ${completed[v.id] ? "done" : ""}" data-video-id="${v.id}" onclick="toggleComplete(this)">
        ${completed[v.id] ? "✓ Completato" : "Segna come completato"}
      </button>
    </div>`).join("");

  return pageShell("Academy", `
  <div class="academy-wrap">
    <div class="eyebrow money">🎓 VenditaUno Academy</div>
    <h1 style="margin-bottom:8px;">Ciao, ${username}</h1>
    <p style="color:var(--muted-foreground);margin-bottom:32px;">Guarda i video e segna come completati man mano che li finisci.</p>
    ${videosHtml}
    <a href="/academy/logout" style="display:block;text-align:center;margin-top:20px;color:var(--muted-foreground);font-size:0.9rem;">Esci</a>
  </div>
  <script>
    function toggleComplete(btn) {
      const id = btn.dataset.videoId;
      const willBeDone = !btn.classList.contains('done');
      fetch('/academy/progress', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({videoId: id, done: willBeDone})
      }).then(() => {
        btn.classList.toggle('done', willBeDone);
        btn.textContent = willBeDone ? '✓ Completato' : 'Segna come completato';
      });
    }
  </script>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/academy" && request.method === "POST") {
      const form = await request.formData();
      const username = (form.get("username") || "").toString().trim();
      const password = (form.get("password") || "").toString();
      const ok = await checkPassword(username, password);
      if (!ok) {
        return new Response(loginPage("Username o password non corretti."), {
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
      }
      const token = await makeSessionToken(username);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/academy",
          "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
        },
      });
    }

    if (url.pathname === "/academy/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/academy",
          "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    if (url.pathname === "/academy/progress" && request.method === "POST") {
      const username = await getSessionUser(request);
      if (!username) return new Response("Unauthorized", { status: 401 });
      const kv = env.ACADEMY_PROGRESS;
      if (!kv) return new Response("KV not configured", { status: 500 });
      const body = await request.json();
      const raw = await kv.get(`progress:${username}`);
      const completed = raw ? JSON.parse(raw) : {};
      completed[body.videoId] = !!body.done;
      await kv.put(`progress:${username}`, JSON.stringify(completed));
      return new Response("ok");
    }

    if (url.pathname === "/academy") {
      const username = await getSessionUser(request);
      if (!username) {
        return new Response(loginPage(null), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
      }
      return new Response(await academyPage(username, env, request), {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
