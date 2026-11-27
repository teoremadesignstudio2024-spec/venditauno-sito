import { DASH_PATH, CLI_PATH, TV_PATH, handleDashboard, ClientiStore } from "./dashboard.js";

// Archivio dei clienti attivi della dashboard (Durable Object).
export { ClientiStore };
import { handleAcademyApi } from "./academy-api.js";

// Pagine tolte dal sito: chi ha un vecchio link finisce sulla home invece che su una pagina vuota.
const REMOVED = [ "/provegestionale", "/ahmis", "/stefanobonuccelli", "/consulting", "/agenti", "/webinar"];
function isRemoved(path) {
  const p = path.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  return REMOVED.some((r) => p === r || p.startsWith(r + "/"));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Vendita Uno Academy: API e pagine (/academy). Niente cache, così ogni aggiornamento si vede subito.
    if (url.pathname.startsWith("/api/academy/")) {
      return handleAcademyApi(request, env);
    }
    if (url.pathname === "/worker.js" || url.pathname === "/dashboard.js" || url.pathname === "/academy-api.js") {
      return new Response("Not found", { status: 404 });
    }
    // La vecchia app (/app) è stata tolta: chi ha il link arriva all'Academy.
    if (url.pathname.startsWith("/api/app/")) {
      return new Response("Gone", { status: 410 });
    }
    if (url.pathname === "/app" || url.pathname.startsWith("/app/") || /^\/academy$/i.test(url.pathname) || (/^\/academy\/?$/i.test(url.pathname) && url.pathname !== "/academy/")) {
      return Response.redirect(`${url.origin}/academy/`, 301);
    }
    if (url.pathname.startsWith("/academy/")) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "no-cache");
      return out;
    }

    // Diotti Consulting: l'indirizzo è /diotticonsulting. Le altre grafie e il vecchio /cantieriuno ci arrivano comunque.
    if (/^\/(diotti[-_]consulting|cantieri[-_]?uno|cantieri[-_]?1)\/?$/i.test(url.pathname) || /^\/diotticonsulting\/$/i.test(url.pathname) || (/^\/diotticonsulting$/i.test(url.pathname) && url.pathname !== "/diotticonsulting")) {
      return Response.redirect(`${url.origin}/diotticonsulting`, 301);
    }

    // Thomas il Piccione: l'indirizzo è /thomas; /Thomas, /THOMAS e la barra finale ci arrivano comunque.
    if (/^\/thomas\/?$/i.test(url.pathname) && url.pathname !== "/thomas") {
      return Response.redirect(`${url.origin}/thomas`, 301);
    }

    // Cristina Magni / Metodo 4P: l'indirizzo è /medicinaestetica; le altre grafie ci arrivano comunque.
    if (/^\/medicina[-_]estetica\/?$/i.test(url.pathname) || /^\/medicinaestetica\/$/i.test(url.pathname) || (/^\/medicinaestetica$/i.test(url.pathname) && url.pathname !== "/medicinaestetica")) {
      return Response.redirect(`${url.origin}/medicinaestetica`, 301);
    }

    // Guida gratuita: l'indirizzo è /guidagratuita; /guida-gratuita, /guida gratuita, /GuidaGratuita ecc. ci arrivano comunque.
    {
      let gp = url.pathname;
      try { gp = decodeURIComponent(gp); } catch (e) {}
      if (/^\/guida[\s_-]*gratuita(\.html)?\/?$/i.test(gp) && url.pathname !== "/guidagratuita") {
        return Response.redirect(`${url.origin}/guidagratuita${url.search}`, 301);
      }
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
    // Dashboard clienti attivi: /dashboardclienti (le altre grafie ci arrivano comunque).
    if (/^\/dashboard[-_]?clienti([-_]?attivi)?\/?$/i.test(url.pathname) && url.pathname !== CLI_PATH) {
      return Response.redirect(`${url.origin}${CLI_PATH}`, 301);
    }
    if (url.pathname === CLI_PATH || url.pathname.startsWith(`${CLI_PATH}/`) ||
        url.pathname === DASH_PATH || url.pathname.startsWith(`${DASH_PATH}/`) || url.pathname === TV_PATH || url.pathname === `${TV_PATH}/`) {
      return handleDashboard(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};
