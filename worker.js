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

    // Cantieri Uno: l'indirizzo è /cantieriuno. Le vecchie pagine Diotti Consulting e le altre grafie ci arrivano comunque.
    if (/^\/(diotti[-_]?consulting|cantieri[-_]uno|cantieri[-_]?1)\/?$/i.test(url.pathname) || /^\/cantieriuno\/$/i.test(url.pathname) || (/^\/cantieriuno$/i.test(url.pathname) && url.pathname !== "/cantieriuno")) {
      return Response.redirect(`${url.origin}/cantieriuno`, 301);
    }

    // Thomas il Piccione: l'indirizzo è /thomas; /Thomas, /THOMAS e la barra finale ci arrivano comunque.
    if (/^\/thomas\/?$/i.test(url.pathname) && url.pathname !== "/thomas") {
      return Response.redirect(`${url.origin}/thomas`, 301);
    }

    // Cristina Magni / Metodo 4P: l'indirizzo è /medicinaestetica; le altre grafie ci arrivano comunque.
    if (/^\/medicina[-_]estetica\/?$/i.test(url.pathname) || /^\/medicinaestetica\/$/i.test(url.pathname) || (/^\/medicinaestetica$/i.test(url.pathname) && url.pathname !== "/medicinaestetica")) {
      return Response.redirect(`${url.origin}/medicinaestetica`, 301);
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
