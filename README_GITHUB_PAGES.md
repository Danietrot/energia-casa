# Energia Casa — GitHub Pages

Questa versione NON usa Cloudflare.

## Struttura
Shelly Pro EM-50 → ThingSpeak pubblico → GitHub Pages → PC/iPhone

## Pubblicazione
1. Nel repository `energia-casa` carica/sostituisci i file di questo pacchetto.
2. Puoi eliminare `worker.js` e `wrangler.jsonc`: non servono più.
3. GitHub → Settings → Pages.
4. Build and deployment:
   - Source: Deploy from a branch
   - Branch: main
   - Folder: / (root)
5. Save.
6. Attendi 1–3 minuti e apri l'URL mostrato da GitHub Pages.

## Tariffe
`tariffe.json` contiene le tariffe comuni a tutti i dispositivi.

Esempio:
{
  "2026-09": 0.2500,
  "2026-10": 0.2450
}

La schermata Tariffe permette anche valori locali sul singolo browser.
Con “Esporta JSON” puoi ottenere un nuovo `tariffe.json` da ricaricare su GitHub.

## iPhone
Safari → Condividi → Aggiungi alla schermata Home.

Channel ID già impostato: 3493335.
Nessuna Read API Key è necessaria perché il canale deve essere pubblico.
