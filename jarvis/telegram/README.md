# Jarvis su Telegram

Bot personale: scrivi testo o mandi un vocale, Jarvis risponde con testo e con un vocale generato da Gemini TTS.

## Avvio

```bash
pip install -r requirements.txt
sudo apt install ffmpeg   # serve per convertire l'audio
export TELEGRAM_BOT_TOKEN=...      # da @BotFather
export ANTHROPIC_API_KEY=...
export GEMINI_API_KEY=...          # da Google AI Studio
export TELEGRAM_ALLOWED_CHAT_IDS=123456789   # il tuo chat id: solo lui può usare il bot
python bot.py
```

Facoltative: `CLAUDE_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_STT_MODEL`, `GEMINI_VOICE`.

## Costi (da verificare sui listini prima dell'uso)

- Gemini TTS: circa $20 per milione di token audio in uscita, cioè circa $0.03 al minuto di voce (fonte: pagina prezzi Google Cloud, versione preview).
- Claude: il modello predefinito è Haiku 5.5, il più economico.
- Trascrizione dei vocali: `gemini-2.5-flash`, a costo molto basso.

## Limiti noti

- Le risposte oltre 1500 caratteri arrivano solo come testo.
- La cronologia è in memoria: si azzera al riavvio.
- Il modello TTS è in anteprima: se il nome cambia, imposta `GEMINI_TTS_MODEL`.
