import { DASH_PATH, TV_PATH, handleDashboard } from "./dashboard.js";

// Archivio dei dati della dashboard vendite (vedi wrangler.toml)
export { CrmStore } from "./dashboard.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/worker.js" || url.pathname === "/dashboard.js") {
      return new Response("Not found", { status: 404 });
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

    // La demo del gestionale cambia spesso: niente cache, così si vede sempre l'ultima versione.
    if (url.pathname.startsWith("/provegestionale")) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "no-store, max-age=0");
      return out;
    }

    return env.ASSETS.fetch(request);
  },
};
