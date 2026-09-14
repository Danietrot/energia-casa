# Energia Casa — dashboard Shelly Pro EM-50 + ThingSpeak

Questa versione è pensata per essere pubblicata come **Cloudflare Worker**.

## Cosa fa

- Legge il canale ThingSpeak senza esporre la Read API Key nel browser.
- Mostra:
  - potenza attuale;
  - costo teorico €/h;
  - consumo e costo di oggi;
  - consumo e costo del mese;
  - grafico della potenza giornaliera;
  - consumo orario;
  - consumo giorno per giorno;
  - consumo mese per mese nell'anno.
- Salva le tariffe mensili `€/kWh` in **Cloudflare Workers KV**.
- Protegge i dati con un **codice di accesso**.
- È installabile su iPhone/PC come PWA.

Il Channel ID è già impostato come fallback a **3493335**.
La Read API Key NON è inclusa nel file.

## Configurazione Cloudflare — metodo più semplice dal browser

1. Crea/accedi a un account Cloudflare.
2. Vai in **Workers & Pages** e crea un nuovo Worker, ad esempio `energia-casa`.
3. Apri l'editor del Worker, sostituisci tutto il codice con `worker.js` e salva/deploy.
4. Crea un namespace **Workers KV**, ad esempio `ENERGY_KV`.
5. Nel Worker vai in **Settings → Bindings**:
   - aggiungi un binding KV;
   - nome binding esatto: `ENERGY_KV`;
   - seleziona il namespace appena creato.
6. In **Settings → Variables and Secrets** aggiungi:
   - `THINGSPEAK_READ_API_KEY` = la tua nuova Read API Key — **Secret**;
   - `ACCESS_TOKEN` = un codice lungo scelto da te — **Secret**;
   - opzionale: `THINGSPEAK_CHANNEL_ID` = `3493335`;
   - opzionale: `TIME_ZONE` = `Europe/Rome`.
7. Deploy/Save.
8. Apri l'indirizzo `https://...workers.dev`.
9. Inserisci il valore che hai scelto per `ACCESS_TOKEN`.
10. Apri **Tariffe**, inserisci ad esempio `2026-09` e il tuo costo `€/kWh`.

## Installazione su iPhone

Apri la dashboard in Safari:
**Condividi → Aggiungi alla schermata Home**.

## Importante sullo storico

La dashboard può calcolare solo il periodo già presente in ThingSpeak.
Poiché il canale è stato avviato oggi, non può ricostruire automaticamente il consumo precedente della giornata/mese dal solo contatore cumulativo.

## Note tecniche

ThingSpeak limita una singola lettura a 8.000 punti. Il Worker spezza automaticamente gli intervalli lunghi in blocchi, quindi il riepilogo annuale continua a funzionare anche con dati ogni 5 minuti.

Il costo è calcolato come:
`kWh del periodo × tariffa €/kWh del mese corrispondente`.

Non vengono aggiunti automaticamente quota fissa, trasporto, oneri o imposte: puoi inserire come tariffa il coefficiente complessivo che vuoi usare per il tuo controllo personale.
