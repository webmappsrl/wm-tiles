# Stato del lavoro e decisioni aperte

> Aggiornato al **5 settembre 2026**. Questo file va aggiornato quando cambia
> lo stato: è il punto da cui si riprende.

## Dove siamo

Siamo dentro il **Task 12 — Convergenza dello stile** del piano in
[`features/server-tiles-osm/plan.md`](features/server-tiles-osm/plan.md).

**Fatto** (task 1-11): il servizio, la pipeline dei dati, gli archivi
versionati, il manifest dei gruppi, il filtro dei livelli sul protobuf, le
rotte delle tile, la preview di confronto, lo stile generato, sprite e glifi,
il rilievo dal DEM.

Lo stile è convergente: su **z10–z16** la somiglianza al riferimento è entro
**±2,5 di luminosità** e **±1,8 di contrasto**.

L'area generata copre Appennino Tosco-Emiliano e Monte Pisano
(`10,0 43,62 10,9 44,5`).

**Da fare**:

| task | cosa |
|---|---|
| 13 | renderer raster, per i client che non reggono il vettoriale |
| 14 | pipeline nazionale, mirroring, ritenzione, schedulazione settimanale |
| 15 | rigenerazione on-demand su bounding box |
| 16 | osservabilità, metriche, purge |
| 17 | documentazione operativa — in buona parte coperta da [`runbook.md`](runbook.md) |
| — | **connettore `map-core`**, mai iniziato: richiede `ol` ≥ 7.3.0 |

---

## Le tre decisioni che aspettano una risposta

### 1. DEM a 10 m al posto di Copernicus 30 m

Non serve più a togliere artefatti — quelli sono risolti — ma renderebbe il
rilievo **nitido a z15–z16**, dove oggi si ammorbidisce perché ingrandiamo
dodici volte un dato a 30 m.

TINITALY (INGV) copre l'Italia a 10 m ed è liberamente scaricabile. In
`data/dem-hr/` c'è già `pradarena_5m.tif` per una prova a costo quasi nullo
prima di impegnarsi.

### 2. Fino a che zoom generare il DEM per l'Italia

| | spazio | tempo |
|---|---|---|
| fino a **z14** | ~8 GB | 4-6 ore |
| fino a **z16** | ~130 GB | 12-15 ore |

**z14 è la scelta ragionevole**: l'ombreggiatura ai livelli superiori regge
bene l'overzoom da quando le quote si decodificano in virgola mobile.

### 3. Misurare invece di stimare

I numeri sopra sono estrapolati da **una sola area montuosa** (7.000 km²). La
pianura ha molte meno curve di livello, le Alpi molte di più. Generare una
regione intera — Toscana, o Piemonte per avere le Alpi — darebbe i numeri veri
prima di impegnare una notte di elaborazione.

---

## Aperti, ma minori

- **L'uso suolo regionale** copre da 43,54: per un'area nuova va riletto da
  TGen — una sola importazione, vedi [`import-da-tgen.md`](import-da-tgen.md)
- **z16 non è mai stato validato con il confronto per elemento**, solo con le
  medie globali
- **Un solo file di test** (`test/filter.test.js`, 11 test). Gli strumenti in
  `tools/` misurano ma nessuno gira in automatico e nessuno fallisce da solo
  se una regressione rientra: è così che due difetti gravi dell'ombreggiatura
  sono rimasti invisibili per giorni
- **Le aree chiare**: TGen mostra rocce e praterie d'alta quota dove noi
  mettiamo verde, visibile a z10 e z12. Non è chiaro se sia dato o stile
