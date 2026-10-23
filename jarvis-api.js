// API di Jarvis per la pagina vocale (/jarvis/voce).
//
// Flusso: audio dal browser → trascrizione (Gemini) → risposta (Claude) → voce (Gemini TTS) → WAV.
//
// Configurazione (Cloudflare → Workers → venditauno-sito → Variabili, tipo "Secret"):
//   ANTHROPIC_API_KEY    chiave Anthropic
//   GEMINI_API_KEY       chiave Gemini
//   JARVIS_ACCESS_CODE   codice che la pagina chiede per usare Jarvis
// Facoltativa, come variabile normale:
//   JARVIS_DAILY_LIMIT   richieste al giorno consentite (default 200)

const CLAUDE_MODEL = "claude-haiku-5-5";
const STT_MODEL = "gemini-2.5-flash";
const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const VOICE = "Charon";
// Gemini TTS non ha voci britanniche predefinite: l'accento viene dall'istruzione di stile.
const ACCENT = "Say in a calm, refined British English accent: ";
const MAX_VOICE_CHARS = 1500;
const MAX_AUDIO_B64 = 6 * 1024 * 1024; // circa 4-5 MB di audio
const MAX_HISTORY = 20;

const SYSTEM =
  "Sei Jarvis, un assistente personale. Rispondi in italiano, in modo breve e diretto, " +
  "adatto a essere letto ad alta voce. Niente markdown, niente elenchi lunghi.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store" },
  });
}

// Confronto a tempo costante, per non rivelare il codice dai tempi di risposta.
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}`);
  return res.json();
}

async function transcribe(env, audioB64, mimeType) {
  const data = await gemini(env, STT_MODEL, {
    contents: [{
      parts: [
        { text: "Trascrivi fedelmente questo messaggio vocale in italiano. Restituisci solo il testo." },
        { inlineData: { mimeType, data: audioB64 } },
      ],
    }],
    generationConfig: { temperature: 0 },
  });
  return data.candidates[0].content.parts[0].text.trim();
}

async function askClaude(env, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system: SYSTEM, messages }),
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

export async function handleJarvisApi(request, env) {
  const url = new URL(request.url);

  if (url.pathname !== "/api/jarvis/chat" || request.method !== "POST") {
    return json({ error: "Non trovato." }, 404);
  }
  if (!env.JARVIS_ACCESS_CODE || !env.ANTHROPIC_API_KEY || !env.GEMINI_API_KEY) {
    return json({ error: "Jarvis non è ancora configurato." }, 503);
  }

  const code = request.headers.get("X-Jarvis-Code") || "";
  if (!sameText(code, env.JARVIS_ACCESS_CODE)) {
    return json({ error: "Codice non valido." }, 401);
  }

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

    const reply = await askClaude(env, messages);
    const audio = reply.length <= MAX_VOICE_CHARS ? await speak(env, reply) : null;

    return json({ transcript, reply, audio });
  } catch (err) {
    console.error("jarvis:", err.message);
    return json({ error: "Qualcosa è andato storto. Riprova tra poco." }, 502);
  }
}
