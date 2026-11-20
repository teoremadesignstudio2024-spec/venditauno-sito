import { DASH_PATH, TV_PATH, handleDashboard, ClientiStore } from "./dashboard.js";

// Archivio dei clienti attivi della dashboard (Durable Object).
export { ClientiStore };
import { handleAppApi } from "./app-api.js";

// Pagine tolte dal sito: chi ha un vecchio link finisce sulla home invece che su una pagina vuota.
const REMOVED = ["/academy", "/provegestionale", "/ahmis", "/stefanobonuccelli", "/consulting", "/agenti", "/webinar"];
function isRemoved(path) {
  const p = path.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  return REMOVED.some((r) => p === r || p.startsWith(r + "/"));
}

// Guida gratuita: il modulo della landing /guidagratuita manda qui i dati, noi li salviamo su GoHighLevel.
const GHL_LOCATION_ID = "5Rz7mxEzHiMRzNoYTcXD";
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
async function handleGuida(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Metodo non permesso" }, 405);
  let b;
  try { b = await request.json(); } catch (e) { return json({ ok: false, error: "Dati non validi" }, 400); }
  const clean = (v, max = 120) => String(v || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
  // Campo nascosto: lo compilano solo i bot. Rispondiamo ok senza salvare niente.
  if (clean(b.website)) return json({ ok: true });
  const firstName = clean(b.firstName, 60), lastName = clean(b.lastName, 60), email = clean(b.email, 160).toLowerCase();
  let phone = clean(b.phone, 30).replace(/[^\d+]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (!phone.startsWith("+")) phone = "+39" + phone;
  if (firstName.length < 2 || lastName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || phone.replace(/\D/g, "").length < 9) {
    return json({ ok: false, error: "Controlla i dati inseriti" }, 400);
  }
  const r = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GHL_TOKEN}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ locationId: GHL_LOCATION_ID, firstName, lastName, email, phone, tags: ["guida gratuita"], source: "Landing guida gratuita" }),
  }).catch(() => null);
  if (!r || !r.ok) {
    const t = r ? await r.text().catch(() => "") : "rete";
    console.log("guida: GoHighLevel ha rifiutato il contatto", r && r.status, t.slice(0, 300));
    return json({ ok: false, error: "Salvataggio non riuscito" }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Modulo della guida gratuita: salva il contatto su GoHighLevel con il tag "guida gratuita".
    if (url.pathname === "/api/guida") {
      return handleGuida(request, env);
    }

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
    if (url.pathname === DASH_PATH || url.pathname.startsWith(`${DASH_PATH}/`) || url.pathname === TV_PATH || url.pathname === `${TV_PATH}/`) {
      return handleDashboard(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};
