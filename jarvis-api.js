// API di Jarvis (/jarvis): chat vocale e memoria dell'assistente.
//
// Flusso vocale: audio dal browser → trascrizione (Gemini) → risposta (Claude) → voce (Gemini TTS) → WAV.
// Memoria: testo libero salvato nel KV, letto da Claude a ogni richiesta (clienti, contesto, regole di vendita).
//
// Configurazione (Cloudflare → Workers → venditauno-sito → Variabili, tipo "Secret"):
//   ANTHROPIC_API_KEY    chiave Anthropic
//   GEMINI_API_KEY       chiave Gemini
// Facoltativa, come variabile normale:
//   JARVIS_DAILY_LIMIT   richieste al giorno consentite (default 200)

const CLAUDE_MODEL = "claude-haiku-5-5";
// Modelli per la trascrizione, in ordine di preferenza: si passa al successivo solo se quello non esiste più (404).
const STT_MODELS = ["gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const VOICE = "Charon";
// Gemini TTS non ha voci britanniche predefinite: l'accento viene dall'istruzione di stile.
const ACCENT = "Say in a calm, refined British English accent: ";
const MAX_VOICE_CHARS = 1500;
const MAX_AUDIO_B64 = 6 * 1024 * 1024;
const MAX_HISTORY = 20;
const MAX_MEMORY_CHARS = 20000;
const MEMORY_KEY = "jarvis:memory";

const SYSTEM =
  "Sei Jarvis, l'assistente personale di chi ti parla. Rispondi in italiano, in modo breve e diretto, " +
  "adatto a essere letto ad alta voce. Niente markdown, niente elenchi lunghi. " +
  "Usa la memoria qui sotto quando riguarda clienti, contesto o regole di vendita.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store" },
  });
}

// Contatore giornaliero nel KV: evita costi imprevisti se il link circola.
async function underDailyLimit(env) {
  const limit = parseInt(env.JARVIS_DAILY_LIMIT || "200", 10);
  const day = new Date().toISOString().slice(0, 10);
  const key = `jarvis:count:${day}`;
  const used = parseInt((await env.ACADEMY_PROGRESS.get(key)) || "0", 10);
  if (used >= limit) return false;
  await env.ACADEMY_PROGRESS.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  return true;
}

// Gemini restituisce PCM 24 kHz mono 16 bit: il browser lo riproduce solo come WAV.
function pcmToWavBase64(pcmBytes) {
  const sampleRate = 24000, channels = 1, bits = 16;
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const header = new DataView(new ArrayBuffer(44));
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  header.setUint32(4, 36 + pcmBytes.length, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, byteRate, true);
  header.setUint16(32, blockAlign, true);
  header.setUint16(34, bits, true);
  writeText(36, "data");
  header.setUint32(40, pcmBytes.length, true);

  const wav = new Uint8Array(44 + pcmBytes.length);
  wav.set(new Uint8Array(header.buffer), 0);
  wav.set(pcmBytes, 44);
  let bin = "";
  for (let i = 0; i < wav.length; i += 0x8000) {
    bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function gemini(env, model, body) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Gemini ${model} ${res.status}: ${detail}`);
  }
  return res.json();
}

async function transcribe(env, audioB64, mimeType) {
  const body = {
    contents: [{
      parts: [
        { text: "Trascrivi fedelmente questo messaggio vocale in italiano. Restituisci solo il testo." },
        { inlineData: { mimeType, data: audioB64 } },
      ],
    }],
    generationConfig: { temperature: 0 },
  };
  let lastError;
  for (const model of STT_MODELS) {
    try {
      const data = await gemini(env, model, body);
      return data.candidates[0].content.parts[0].text.trim();
    } catch (err) {
      lastError = err;
      if (!err.message.includes(" 404")) throw err;
    }
  }
  throw lastError;
}

async function askClaude(env, memory, messages) {
  const system = memory
    ? `${SYSTEM}\n\nMEMORIA (scritta da chi ti parla):\n${memory}`
    : SYSTEM;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system, messages }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

async function speak(env, text) {
  const data = await gemini(env, TTS_MODEL, {
    contents: [{ parts: [{ text: ACCENT + text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  });
  const pcmB64 = data.candidates[0].content.parts[0].inlineData.data;
  const bin = atob(pcmB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return pcmToWavBase64(bytes);
}

// Fatturato del mese, letto dai dati della dashboard (chiavi "fatturato:AAAA-MM-GG" nel KV).
function currentMonth() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Rome" }).slice(0, 7);
}

const round2 = (n) => Math.round(n * 100) / 100;

async function revenueMonth(env, month) {
  const list = await env.ACADEMY_PROGRESS.list({ prefix: `fatturato:${month}-` });
  const bySeller = {};
  let total = 0, cashed = 0;
  for (const key of list.keys) {
    const raw = await env.ACADEMY_PROGRESS.get(key.name);
    if (!raw) continue;
    for (const e of JSON.parse(raw).entries || []) {
      const amount = Number(e.amount) || 0;
      total += amount;
      cashed += Number(e.cashed) || 0;
      bySeller[e.seller] = round2((bySeller[e.seller] || 0) + amount);
    }
  }
  return { month, total: round2(total), cashed: round2(cashed), bySeller };
}

function revenueText(r) {
  const sellers = Object.entries(r.bySeller).map(([name, v]) => `${name} ${v} €`).join(", ") || "nessuna vendita";
  return `Fatturato del mese ${r.month}: ${r.total} € (incassato ${r.cashed} €). Per venditore: ${sellers}.`;
}

async function handleMemory(request, env) {
  if (request.method === "GET") {
    const text = (await env.ACADEMY_PROGRESS.get(MEMORY_KEY)) || "";
    return json({ memory: text });
  }
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Richiesta non valida." }, 400);
    }
    const text = typeof body.memory === "string" ? body.memory.slice(0, MAX_MEMORY_CHARS) : "";
    await env.ACADEMY_PROGRESS.put(MEMORY_KEY, text);
    return json({ ok: true });
  }
  return json({ error: "Metodo non consentito." }, 405);
}

export async function handleJarvisApi(request, env) {
  const url = new URL(request.url);
  const isChat = url.pathname === "/api/jarvis/chat" && request.method === "POST";
  const isMemory = url.pathname === "/api/jarvis/memory";
  const isNumbers = url.pathname === "/api/jarvis/numeri" && request.method === "GET";
  if (!isChat && !isMemory && !isNumbers) return json({ error: "Non trovato." }, 404);

  if (!env.ANTHROPIC_API_KEY || !env.GEMINI_API_KEY) {
    return json({ error: "Jarvis non è ancora configurato." }, 503);
  }
  if (isMemory) return handleMemory(request, env);
  if (isNumbers) return json(await revenueMonth(env, currentMonth()));

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Richiesta non valida." }, 400);
  }

  if (body.audio && body.audio.length > MAX_AUDIO_B64) {
    return json({ error: "Messaggio vocale troppo lungo." }, 413);
  }
  if (!body.audio && !(typeof body.text === "string" && body.text.trim())) {
    return json({ error: "Scrivi o registra un messaggio." }, 400);
  }

  if (!(await underDailyLimit(env))) {
    return json({ error: "Limite giornaliero raggiunto. Riprova domani." }, 429);
  }

  try {
    const transcript = body.audio
      ? await transcribe(env, body.audio, body.mimeType || "audio/webm")
      : body.text.trim();

    // La cronologia arriva dal browser: si tiene solo la parte recente.
    const past = Array.isArray(body.history)
      ? body.history
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-MAX_HISTORY)
      : [];
    const messages = [...past, { role: "user", content: transcript }];

    const memory = (await env.ACADEMY_PROGRESS.get(MEMORY_KEY)) || "";
    const revenue = revenueText(await revenueMonth(env, currentMonth()));
    const reply = await askClaude(env, `${revenue}\n\n${memory}`.trim(), messages);
    const audio = reply.length <= MAX_VOICE_CHARS ? await speak(env, reply) : null;

    return json({ transcript, reply, audio });
  } catch (err) {
    console.error("jarvis:", err.message);
    return json({ error: `Errore: ${err.message}` }, 502);
  }
}
