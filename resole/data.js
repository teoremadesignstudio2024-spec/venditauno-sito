// Dati dell'agenzia e degli immobili in vendita.
// Gli immobili qui sotto sono di esempio: sostituirli con quelli reali.
// Per aggiungere una foto: caricarla in resole/assets/immobili/ e valorizzare il campo "foto".

const AGENZIA = {
  nome: "Re Sole",
  ragioneSociale: "Re Sole Agenzia Immobiliare",
  sede: "Pieve Ligure (GE)",
  telefono: "+39 0185 000 000",
  telefonoLink: "+390185000000",
  email: "info@resole-immobiliare.it",
  orari: "Lun–Ven 9:00–13:00 e 15:00–19:00 · Sabato su appuntamento",
  // Endpoint che riceve il modulo di valutazione (POST JSON).
  // Se vuoto, il modulo apre l'app email con i dati già compilati.
  endpointValutazione: "",
};

const IMMOBILI = [
  {
    id: "RS-1024",
    titolo: "Appartamento con vista mare",
    tipologia: "Appartamento",
    localita: "Pieve Ligure",
    prezzo: 485000,
    superficie: 96,
    locali: 3,
    bagni: 2,
    descrizione:
      "Luminoso appartamento al piano alto con ampio soggiorno affacciato sul golfo. Cucina abitabile, due camere matrimoniali e doppi servizi. Ideale come residenza o casa per le vacanze.",
    dotazioni: ["Balcone panoramico", "Cantina", "Posto auto", "Riscaldamento autonomo"],
    foto: null,
  },
  {
    id: "RS-1031",
    titolo: "Villa con giardino e vista panoramica",
    tipologia: "Villa",
    localita: "Pieve Ligure",
    prezzo: 1250000,
    superficie: 280,
    locali: 6,
    bagni: 3,
    descrizione:
      "Villa indipendente immersa nel verde, con giardino privato e vista aperta sul mare. Ampi spazi living, cucina separata, quattro camere e garage doppio.",
    dotazioni: ["Giardino privato", "Garage doppio", "Terrazza panoramica", "Classe energetica B"],
    foto: null,
  },
  {
    id: "RS-1040",
    titolo: "Attico con terrazza panoramica",
    tipologia: "Attico",
    localita: "Pieve Ligure",
    prezzo: 720000,
    superficie: 130,
    locali: 4,
    bagni: 2,
    descrizione:
      "Attico su due livelli con terrazza di oltre 60 m², perfetto per chi cerca spazi aperti e luce naturale tutto il giorno. Finiture di pregio e zona giorno con camino.",
    dotazioni: ["Terrazza 60 m²", "Ascensore", "Camino", "Climatizzazione"],
    foto: null,
  },
  {
    id: "RS-1052",
    titolo: "Bilocale ristrutturato a pochi passi dal mare",
    tipologia: "Appartamento",
    localita: "Pieve Ligure",
    prezzo: 265000,
    superficie: 58,
    locali: 2,
    bagni: 1,
    descrizione:
      "Bilocale completamente ristrutturato, con cucina a vista e camera separata. Posizione comoda e servita, a breve distanza dalla spiaggia e dai servizi.",
    dotazioni: ["Ristrutturato", "Arredo incluso", "Doppi vetri", "Ripostiglio"],
    foto: null,
  },
  {
    id: "RS-1063",
    titolo: "Rustico in collina con uliveto",
    tipologia: "Rustico",
    localita: "Pieve Ligure",
    prezzo: 390000,
    superficie: 170,
    locali: 5,
    bagni: 2,
    descrizione:
      "Rustico in pietra con ampio terreno coltivato a uliveto. Ottimo potenziale per una residenza di carattere con piccola attività agricola o agrituristica.",
    dotazioni: ["Terreno con uliveto", "Taverna con camino", "Depositi", "Vista collina"],
    foto: null,
  },
  {
    id: "RS-1077",
    titolo: "Trilocale con garage",
    tipologia: "Appartamento",
    localita: "Pieve Ligure",
    prezzo: 340000,
    superficie: 85,
    locali: 3,
    bagni: 1,
    descrizione:
      "Trilocale in palazzina con giardino condominiale, tranquillo e ben collegato. Garage incluso nel prezzo e spazi ben distribuiti.",
    dotazioni: ["Garage incluso", "Giardino condominiale", "Esposizione doppia", "Balcone"],
    foto: null,
  },
];
