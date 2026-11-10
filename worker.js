import { DASH_PATH, TV_PATH, handleDashboard } from "./dashboard.js";
import { handleAppApi } from "./app-api.js";

// Pagine tolte dal sito: chi ha un vecchio link finisce sulla home invece che su una pagina vuota.
const REMOVED = ["/academy", "/provegestionale", "/ahmis", "/stefanobonuccelli", "/consulting", "/agenti", "/webinar"];
function isRemoved(path) {
  const p = path.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  return REMOVED.some((r) => p === r || p.startsWith(r + "/"));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // App Vendita Uno: API e pagine (/app). Niente cache, così ogni aggiornamento si vede subito.
    if (url.pathname.startsWith("/api/app/")) {
      return handleAppApi(request, env);
    }
    if (url.pathname === "/app-api.js" || url.pathname === "/worker.js" || url.pathname === "/dashboard.js") {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "no-cache");
      return out;
    }

    // Diotti Consulting: anche chi scrive l'indirizzo senza trattino arriva alla pagina giusta.
    if (/^\/diotti_?consulting\/?$/i.test(url.pathname) || /^\/diotti-consulting\/$/i.test(url.pathname) || url.pathname === "/Diotti-Consulting") {
      return Response.redirect(`${url.origin}/diotti-consulting`, 301);
    }

    if (isRemoved(url.pathname)) {
      return Response.redirect(`${url.origin}/`, 301);
    }

    // Dashboard vendite + schermata TV (accetta anche /dashboardvenditatopù digitato per errore)
    let decodedPath = url.pathname;
    try { decodedPath = decodeURIComponent(url.pathname); } catch (e) {}
    if (decodedPath.startsWith(`${DASH_PATH}ù`)) {
      return Response.redirect(`${url.origin}${DASH_PATH}`, 302);
    }
    if (url.pathname === DASH_PATH || url.pathname.startsWith(`${DASH_PATH}/`) || url.pathname === TV_PATH || url.pathname === `${TV_PATH}/`) {
      return handleDashboard(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};
