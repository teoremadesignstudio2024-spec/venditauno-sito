"""Jarvis su Telegram: riceve testo o vocali, risponde con testo e vocale.

- Testo e ragionamento: API Claude (Anthropic SDK).
- Voce in uscita: Gemini TTS (la risposta audio PCM viene convertita in OGG/Opus).
- Voce in entrata: Gemini trascrive il vocale, poi lo stesso flusso del testo.

Variabili d'ambiente richieste:
  TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, GEMINI_API_KEY
  TELEGRAM_ALLOWED_CHAT_IDS  elenco di chat id separati da virgola (obbligatorio)
Facoltative:
  CLAUDE_MODEL      default claude-haiku-5-5
  GEMINI_TTS_MODEL  default gemini-3.1-flash-tts-preview
  GEMINI_VOICE      default Kore
"""

import base64
import os
import subprocess
from collections import defaultdict

import anthropic
import httpx

TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
GEMINI_KEY = os.environ["GEMINI_API_KEY"]
ALLOWED = {int(x) for x in os.environ["TELEGRAM_ALLOWED_CHAT_IDS"].split(",") if x.strip()}
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-haiku-5-5")
TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
VOICE = os.environ.get("GEMINI_VOICE", "Charon")
# Gemini TTS non ha voci britanniche predefinite: l'accento viene dall'istruzione di stile.
ACCENT = "Say in a calm, refined British English accent: "
STT_MODEL = os.environ.get("GEMINI_STT_MODEL", "gemini-2.5-flash")

TG = f"https://api.telegram.org/bot{TG_TOKEN}"
TG_FILE = f"https://api.telegram.org/file/bot{TG_TOKEN}"
GEMINI = "https://generativelanguage.googleapis.com/v1beta/models"
MAX_VOICE_CHARS = 1500  # oltre questa soglia la risposta resta solo testo

SYSTEM = (
    "Sei Jarvis, un assistente personale. Rispondi in italiano, in modo breve e diretto, "
    "adatto a essere letto ad alta voce. Niente markdown, niente elenchi lunghi."
)

claude = anthropic.Anthropic()
http = httpx.Client(timeout=120)
history = defaultdict(list)  # chat_id -> messaggi recenti


def send_text(chat_id, text):
    http.post(f"{TG}/sendMessage", json={"chat_id": chat_id, "text": text})


def send_voice(chat_id, ogg_bytes):
    http.post(
        f"{TG}/sendVoice",
        data={"chat_id": chat_id},
        files={"voice": ("risposta.ogg", ogg_bytes, "audio/ogg")},
    )


def ask_claude(chat_id, user_text):
    history[chat_id].append({"role": "user", "content": user_text})
    history[chat_id] = history[chat_id][-20:]
    resp = claude.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=SYSTEM,
        messages=history[chat_id],
    )
    answer = "".join(b.text for b in resp.content if b.type == "text").strip()
    history[chat_id].append({"role": "assistant", "content": answer})
    return answer


def gemini_generate(model, body):
    r = http.post(
        f"{GEMINI}/{model}:generateContent",
        headers={"x-goog-api-key": GEMINI_KEY},
        json=body,
    )
    r.raise_for_status()
    return r.json()


def text_to_ogg(text):
    """Gemini TTS -> PCM 24 kHz mono 16 bit -> OGG/Opus per Telegram."""
    data = gemini_generate(TTS_MODEL, {
        "contents": [{"parts": [{"text": ACCENT + text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}},
        },
    })
    pcm = base64.b64decode(data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    ogg = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
         "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"],
        input=pcm, capture_output=True, check=True,
    )
    return ogg.stdout


def transcribe(ogg_bytes):
    """Vocale Telegram (OGG) -> WAV mono 16 kHz -> testo tramite Gemini."""
    wav = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
        input=ogg_bytes, capture_output=True, check=True,
    ).stdout
    data = gemini_generate(STT_MODEL, {
        "contents": [{"parts": [
            {"text": "Trascrivi fedelmente questo messaggio vocale in italiano. Restituisci solo il testo."},
            {"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(wav).decode()}},
        ]}],
        "generationConfig": {"temperature": 0},
    })
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def download_telegram_file(file_id):
    info = http.get(f"{TG}/getFile", params={"file_id": file_id}).json()["result"]
    return http.get(f"{TG_FILE}/{info['file_path']}").content


def handle(message):
    chat_id = message["chat"]["id"]
    if chat_id not in ALLOWED:
        send_text(chat_id, "Questo bot è privato.")
        return

    if "voice" in message:
        user_text = transcribe(download_telegram_file(message["voice"]["file_id"]))
        send_text(chat_id, f"Hai detto: {user_text}")
    elif "text" in message:
        user_text = message["text"]
    else:
        return

    answer = ask_claude(chat_id, user_text)
    send_text(chat_id, answer)
    if len(answer) <= MAX_VOICE_CHARS:
        send_voice(chat_id, text_to_ogg(answer))


def main():
    offset = None
    while True:
        params = {"timeout": 50, "allowed_updates": ["message"]}
        if offset:
            params["offset"] = offset
        updates = http.get(f"{TG}/getUpdates", params=params, timeout=60).json().get("result", [])
        for upd in updates:
            offset = upd["update_id"] + 1
            try:
                handle(upd["message"])
            except Exception as exc:  # il bot non deve morire per un singolo messaggio
                print("errore:", exc)


if __name__ == "__main__":
    main()
