(function () {
  const form = document.getElementById("form-valutazione");
  const invio = document.getElementById("invio");
  const esito = document.getElementById("esito");

  const ETICHETTA_INVIO = invio.textContent;

  function mostraEsito(messaggio, tipo) {
    esito.textContent = messaggio;
    esito.className = `form-esito ${tipo}`;
  }

  function leggiDati() {
    const dati = new FormData(form);
    return {
      nome: dati.get("nome").trim(),
      cognome: dati.get("cognome").trim(),
      telefono: dati.get("telefono").trim(),
      email: dati.get("email").trim(),
      tipologia: dati.get("tipologia"),
      superficie: dati.get("superficie"),
      indirizzo: dati.get("indirizzo").trim(),
      note: dati.get("note").trim(),
      fonte: "Sito Re Sole · Valutazione",
      data: new Date().toISOString(),
    };
  }

  function testoEmail(d) {
    return [
      `Richiesta di valutazione`,
      ``,
      `Nome: ${d.nome} ${d.cognome}`,
      `Telefono: ${d.telefono}`,
      `Email: ${d.email}`,
      `Tipologia: ${d.tipologia}`,
      `Superficie: ${d.superficie ? d.superficie + " m²" : "non indicata"}`,
      `Zona / indirizzo: ${d.indirizzo}`,
      ``,
      `Note:`,
      d.note || "-",
    ].join("\n");
  }

  async function inviaAlServer(dati) {
    const risposta = await fetch(AGENZIA.endpointValutazione, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dati),
    });
    if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
  }

  function apriEmail(dati) {
    const oggetto = `Richiesta di valutazione · ${dati.indirizzo}`;
    window.location.href = `mailto:${AGENZIA.email}?subject=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(testoEmail(dati))}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      mostraEsito("Controlla i campi evidenziati e riprova.", "errore");
      return;
    }

    const dati = leggiDati();
    invio.disabled = true;
    invio.textContent = "Invio in corso...";
    mostraEsito("", "");

    try {
      if (AGENZIA.endpointValutazione) {
        await inviaAlServer(dati);
        form.reset();
        mostraEsito("Grazie, la richiesta è stata inviata. Ti contatteremo al più presto.", "ok");
      } else {
        apriEmail(dati);
        mostraEsito("Si apre la tua app email con i dati già compilati. Premi invia per completare la richiesta.", "ok");
      }
    } catch (err) {
      mostraEsito(`Non siamo riusciti a inviare la richiesta. Puoi scriverci a ${AGENZIA.email} o chiamarci.`, "errore");
    } finally {
      invio.disabled = false;
      invio.textContent = ETICHETTA_INVIO;
    }
  });
})();
