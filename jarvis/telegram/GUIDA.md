# Guida: Jarvis su Telegram con risposte vocali

Obiettivo: scrivi a Jarvis su Telegram, lui risponde con testo e con un vocale generato da Gemini.

Tempo stimato: 20-30 minuti la prima volta.

---

## 1. Crea il bot su Telegram

1. Apri Telegram e cerca **@BotFather**.
2. Scrivi `/newbot`.
3. Scegli un nome visibile (es. `Jarvis Venditauno`).
4. Scegli uno username che finisca con `bot` (es. `jarvis_venditauno_bot`).
5. BotFather ti restituisce un **token** del tipo `123456789:AA...`. Copialo e tienilo segreto.

## 2. Ottieni le chiavi API

**Gemini (voce e trascrizione)**
1. Vai su https://aistudio.google.com/apikey.
2. Crea una chiave API e copiala.
3. Se in seguito vedi errori di quota, controlla la fatturazione del progetto Google nella console.

**Anthropic (Claude, il cervello di Jarvis)**
1. Vai su https://console.anthropic.com.
2. Crea una chiave in *API Keys* e copiala.

## 3. Scopri il tuo chat id

Solo il tuo chat id può usare il bot. Lo ricavi così:

1. Su Telegram apri il bot appena creato e scrivigli un messaggio qualsiasi (es. `ciao`).
2. Apri nel browser questo indirizzo, sostituendo `TOKEN` con il tuo token:
   `https://api.telegram.org/botTOKEN/getUpdates`
3. Nella risposta cerca `"chat":{"id": 123456789`. Quel numero è il tuo chat id.

## 4. Installa i prerequisiti

- **Python 3.10 o successivo.** Verifica con `python3 --version`.
- **ffmpeg**, che converte l'audio:
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: `winget install ffmpeg` (poi riapri il terminale)

## 5. Installa Jarvis

Dalla cartella del repository:

```bash
cd jarvis/telegram
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 6. Imposta le variabili d'ambiente

macOS / Linux:

```bash
export TELEGRAM_BOT_TOKEN="il-token-di-botfather"
export ANTHROPIC_API_KEY="la-chiave-anthropic"
export GEMINI_API_KEY="la-chiave-gemini"
export TELEGRAM_ALLOWED_CHAT_IDS="il-tuo-chat-id"
```

Windows (PowerShell):

```powershell
$env:TELEGRAM_BOT_TOKEN="il-token-di-botfather"
$env:ANTHROPIC_API_KEY="la-chiave-anthropic"
$env:GEMINI_API_KEY="la-chiave-gemini"
$env:TELEGRAM_ALLOWED_CHAT_IDS="il-tuo-chat-id"
```

Facoltative, con i valori predefiniti:
- `CLAUDE_MODEL=claude-haiku-5-5`
- `GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview`
- `GEMINI_STT_MODEL=gemini-2.5-flash`
- `GEMINI_VOICE=Kore`

## 7. Avvia il bot

```bash
python bot.py
```

Il terminale resta aperto e il bot risponde finché lo tieni in esecuzione.

## 8. Prova

1. Scrivi `ciao` al bot. Dovresti ricevere un messaggio di testo e poi un vocale.
2. Manda un **vocale** dal telefono. Il bot risponde con `Hai detto: ...` e poi con la risposta in testo e voce.

Se non ricevi il vocale, controlla il terminale: gli errori vengono stampati lì.

---

## Problemi comuni

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| "Questo bot è privato." | Il chat id non è in `TELEGRAM_ALLOWED_CHAT_IDS` | Ripeti il passo 3 e controlla la variabile |
| `FileNotFoundError: ffmpeg` | ffmpeg non installato o non nel PATH | Installa ffmpeg e riapri il terminale |
| Errore 404 sul modello Gemini | Il nome del modello TTS è cambiato | Imposta `GEMINI_TTS_MODEL` con il nome corrente nella documentazione Google |
| Errore 429 o quota esaurita | Limite di richieste o fatturazione | Controlla quote e fatturazione nel progetto Google |
| Il testo arriva, il vocale no | Risposta oltre 1500 caratteri | È voluto: le risposte lunghe restano solo testo |
| Il bot smette di rispondere | Il terminale è stato chiuso o il processo si è fermato | Riavvia con `python bot.py` |

## Costi

- Voce Gemini TTS: circa $0.03 al minuto di audio generato (da verificare sul listino Google).
- Claude Haiku 5.5: pochi centesimi al giorno con un uso normale.
- Trascrizione dei vocali con Gemini Flash: trascurabile per uso personale.

## Limiti da sapere

- Il bot gira solo mentre il terminale è aperto. Per tenerlo sempre acceso serve un server: lo impostiamo dopo.
- La cronologia della conversazione è in memoria e si azzera al riavvio.
- Il modello TTS è in anteprima: il nome può cambiare.
