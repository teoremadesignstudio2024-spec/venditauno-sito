(function () {
  const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const griglia = document.getElementById("griglia-immobili");
  const filtroTipo = document.getElementById("filtro-tipologia");
  const filtroPrezzo = document.getElementById("filtro-prezzo");
  const filtroOrdine = document.getElementById("filtro-ordine");
  const conteggio = document.getElementById("conteggio");
  const dialog = document.getElementById("dettaglio");
  const dialogContenuto = document.getElementById("dettaglio-contenuto");
  const dialogChiudi = document.getElementById("dettaglio-chiudi");

  function esc(valore) {
    return String(valore).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function fotoHTML(im) {
    if (im.foto) {
      return `<img src="${esc(im.foto)}" alt="${esc(im.titolo)}" loading="lazy">`;
    }
    return `<div class="foto-placeholder" aria-hidden="true"><span>Foto in arrivo</span></div>`;
  }

  function mailtoRichiesta(im) {
    const oggetto = `Richiesta informazioni · Rif. ${im.id}`;
    const corpo = `Buongiorno, vorrei ricevere maggiori informazioni sull'immobile "${im.titolo}" (Rif. ${im.id}).`;
    return `mailto:${AGENZIA.email}?subject=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(corpo)}`;
  }

  function cardHTML(im) {
    return `
      <article class="card">
        <div class="card-foto">
          ${fotoHTML(im)}
          <span class="badge">${esc(im.tipologia)}</span>
        </div>
        <div class="card-body">
          <p class="card-loc">${esc(im.localita)} · Rif. ${esc(im.id)}</p>
          <h3>${esc(im.titolo)}</h3>
          <p class="card-specs">${im.locali} locali · ${im.bagni} ${im.bagni === 1 ? "bagno" : "bagni"} · ${im.superficie} m²</p>
          <div class="card-footer">
            <span class="card-prezzo">${euro.format(im.prezzo)}</span>
            <button class="card-open" type="button" data-id="${esc(im.id)}" aria-label="Apri i dettagli di ${esc(im.titolo)}">Dettagli</button>
          </div>
        </div>
      </article>`;
  }

  function dettaglioHTML(im) {
    const dotazioni = im.dotazioni.map((d) => `<li>${esc(d)}</li>`).join("");
    return `
      <div class="dettaglio-foto">
        ${fotoHTML(im)}
      </div>
      <div class="dettaglio-body">
        <div>
          <p class="card-loc">${esc(im.localita)} · Rif. ${esc(im.id)}</p>
          <h2 id="dettaglio-titolo">${esc(im.titolo)}</h2>
          <p class="descrizione">${esc(im.descrizione)}</p>
          <ul class="dotazioni">${dotazioni}</ul>
        </div>
        <aside class="dettaglio-side">
          <p class="dettaglio-prezzo">${euro.format(im.prezzo)}</p>
          <ul class="dettaglio-specs">
            <li><strong>${im.locali}</strong><span>Locali</span></li>
            <li><strong>${im.bagni}</strong><span>${im.bagni === 1 ? "Bagno" : "Bagni"}</span></li>
            <li><strong>${im.superficie} m²</strong><span>Superficie</span></li>
            <li><strong>${esc(im.tipologia)}</strong><span>Tipologia</span></li>
          </ul>
          <a class="btn btn-gold btn-block" href="${mailtoRichiesta(im)}">Richiedi informazioni</a>
          <a class="btn btn-ghost btn-block" href="tel:${AGENZIA.telefonoLink}">Chiama l'agenzia</a>
        </aside>
      </div>`;
  }

  function rientraNelBudget(prezzo, fascia) {
    if (!fascia) return true;
    const [min, max] = fascia.split("-").map(Number);
    return prezzo >= min && prezzo <= max;
  }

  function ordina(lista, criterio) {
    const copia = [...lista];
    if (criterio === "prezzo-desc") return copia.sort((a, b) => b.prezzo - a.prezzo);
    if (criterio === "superficie-desc") return copia.sort((a, b) => b.superficie - a.superficie);
    return copia.sort((a, b) => a.prezzo - b.prezzo);
  }

  function aggiorna() {
    const tipo = filtroTipo.value;
    const fascia = filtroPrezzo.value;

    const risultati = ordina(
      IMMOBILI.filter((im) => (tipo === "tutti" || im.tipologia === tipo) && rientraNelBudget(im.prezzo, fascia)),
      filtroOrdine.value
    );

    griglia.innerHTML = risultati.length
      ? risultati.map(cardHTML).join("")
      : `<p class="vuoto">Nessun immobile corrisponde ai filtri selezionati. Prova a modificarli o <a href="#contatti">contattaci</a> per una ricerca personalizzata.</p>`;

    conteggio.textContent = `${risultati.length} ${risultati.length === 1 ? "immobile" : "immobili"}`;
  }

  function apriDettaglio(id) {
    const im = IMMOBILI.find((x) => x.id === id);
    if (!im) return;
    dialogContenuto.innerHTML = dettaglioHTML(im);
    dialog.showModal();
  }

  griglia.addEventListener("click", (e) => {
    const bottone = e.target.closest(".card-open");
    if (bottone) apriDettaglio(bottone.dataset.id);
  });

  dialogChiudi.addEventListener("click", () => dialog.close());

  // Chiude cliccando sullo sfondo (il click cade sul dialog stesso, fuori dal contenuto).
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", () => {
    dialogContenuto.innerHTML = "";
  });

  [filtroTipo, filtroPrezzo, filtroOrdine].forEach((el) => el.addEventListener("change", aggiorna));

  aggiorna();
})();
