# Energia Casa — layout stile pannello scuro

Questa versione è pensata per GitHub Pages e per un solo canale energia "Casa".

## Caratteristiche
- layout simile allo screenshot che hai inviato;
- nessuna linea "Prese" e "Clima";
- top cards: Casa, costo ora, ora locale, oggi, da inizio mese;
- grafico ultimi 7 giorni con kWh + costo;
- riepilogo costi oggi / mese;
- grafico potenza istantanea;
- grafico consumo per intervallo;
- tariffe per mese salvabili localmente nel browser.

## File da caricare nel repository
- index.html
- manifest.webmanifest
- sw.js
- icon.svg
- tariffe.json
- .nojekyll
- README.md

## Nota importante
Il canale ThingSpeak deve essere pubblico. 
Se aprendo:
https://api.thingspeak.com/channels/3493335/feeds.json?results=2
vedi `-1`, la dashboard non potrà leggere i dati.

## GitHub Pages
Settings → Pages → Deploy from a branch → main → /(root)

## Tariffe
Puoi modificare `tariffe.json` nel repository per avere un valore iniziale comune.

## Tariffa predefinita
La dashboard usa **0,31 €/kWh** come valore predefinito per qualunque mese non personalizzato. Puoi comunque sovrascrivere ogni singolo mese dalla schermata Tariffe.
