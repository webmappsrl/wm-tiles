# Revisione delle tile — note e deviazioni

Deviazioni dal piano, decise durante l'implementazione (12 ottobre 2026).

- **Collaudo**: il piano prevedeva di ritrovare gli strati IGM mancanti da
  z14. Non mancano piu': `tgen-copertura.mjs` li trova coperti e
  `docs/stato.md` era rimasto indietro. Il collaudo e' diventato `--senza
  <layer>`: il locale si rende senza un layer e il sistema deve segnalarlo.
  E' piu' severo, e si puo' ripetere.
- **Il primo collaudo e' fallito, e ha cambiato la misura.** Togliendo
  `contour`, `track` e `road-fill-minor` il sistema dava zero difformita':
  - linee sottili: la maschera e' larga almeno 2 px, la linea 1, e la
    mediana cadeva sul fondo da entrambe le parti. Ora linee e cerchi si
    misurano sull'inchiostro (il quarto dei pixel piu' lontano dal colore
    dell'anello attorno alla maschera);
  - strade: il riempimento sta sempre sopra il bordo, e con la regola "solo
    dove il layer e' l'unico" non aveva mai pixel. Ora un pixel appartiene
    al layer piu' in alto che lo copre.
  Dopo: i tre layer escono a z13, z14 e z15, tranne `contour` a z14.
- **Limite noto**: le curve mancanti a z14 non escono. A quel livello l'ombra
  e' composta in modo normale e forte, e senza curve l'inchiostro del locale
  cade sui versanti in ombra, di tono simile. Escono a z13 e z15.
- **Etichette e icone**: il piano le escludeva (zone etichetta), ma sono la
  maggior parte delle differenze visibili. Ogni layer symbol ha ora la sua
  zona, e si confronta la quota d'inchiostro dei due lati: fuori da [1/2, 2]
  in modo sistematico e' una difformita' `simboli`. La posizione non conta.
- **Tile uniformi**: la cella di Pisa e' quasi tutta mare e il primo campione
  era fatto di tile azzurre. Si pesca da un bacino 4 volte piu' grande e si
  scartano le tile di TGen assenti o uniformi; per questo `campiona` rende le
  tile nell'ordine di estrazione, cosi' un prefisso resta stratificato.
- **EPIPE dopo la resa**: la resa tiene ferma la connessione oltre il
  keep-alive del server; le richieste delle tile vettoriali riprovano una
  volta.
- **Nomi**: gli identificatori sono in italiano come il resto del repo;
  l'utente preferisce l'inglese nel codice nuovo e li ha accettati "per ora".

## Dopo la review indipendente (12 ottobre 2026)

La review ha trovato tre difetti critici, tutti silenziosi:

- **residuo cieco**: le superfici (uso suolo, acqua) coprono tutta la tile e
  "spiegavano" ogni pixel: zero residui su 193 tile. Ora spiegano solo le
  superfici sbagliate in quella tile; linee e zone etichetta restano;
- **le zone dei nomi lungo le linee** toglievano dalla misura strade, fiumi e
  sentieri (`road-fill-major` misurata su 0 tile da z14). Dalle linee si
  escludono solo le zone dei punti e dei poligoni; da 3 px una linea si misura
  con la mediana, cosi' il nome scritto sopra resta minoranza;
- **copertura sul server**: `build-italia.sh` non dichiara celle, e senza
  riquadri tutto risultava coperto. Ora serve `--copertura`, e la copertura e'
  l'unione dei riquadri (una z8 non entra in una cella di un grado, in due
  contigue si').

Poi: verdetti che si riaprono anche su rapporto, pixel e colore locale;
regressioni su presenza, rapporto e layer spariti; zone dei nomi dei poligoni
al centro; una larghezza per linea (le larghe 0 non hanno maschera); errori di
resa e di rete che non fanno cadere il giro.

Il collaudo ha mostrato che anche col residuo corretto le **piste assenti**
non uscivano: tono a ~20 dal fondo, tratti di 3 px. Il residuo ora conta
anche il dettaglio (luminosita' meno la media 7x7: TGen netto dove il locale
e' liscio e il pixel differisce), e i tratti vicini si uniscono prima di
cercare le regioni. `--senza track --ignora track` fa uscire
`z14:residuo:#b0b0b0`, assente nel giro normale.

Due difetti introdotti dalle correzioni e trovati rifacendo il giro: le zone
dell'icona e del nome della stessa cima si escludevano a vicenda (ora le zone
quasi coincidenti non si escludono), e `--confronta` su un campione diverso
dava decine di layer "spariti" (ora si rifiuta, prima della resa).

Due giri identici danno le stesse difformita' e zero regressioni.
