#!/usr/bin/env bash
# Pubblica il server delle tile su un dominio, con HTTPS. Si lancia come root sul
# server, dopo prepara-server.sh e dopo aver puntato il dominio al server.
# In produzione il dominio e' l'ORIGINE di CloudFront, e PUBLIC_URL e' l'indirizzo
# pubblico con cui il server scrive gli URL dello stile:
#
#   ssh wm-tiles 'DOMINIO=origine.tiles.maphub.it PUBLIC_URL=https://tiles.maphub.it bash -s' < infra/pubblica-dominio.sh
#
# Si puo' rilanciare. Cosa fa e perche':
# - il server Node come servizio systemd, in ascolto SOLO su 127.0.0.1:8080:
#   da fuori si passa dal proxy;
# - Caddy come reverse proxy: ottiene e rinnova da solo il certificato, solo da
#   Let's Encrypt, che pero' lo rilascia solo se il DNS del dominio punta gia' qui.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
: "${DOMINIO:?passa il dominio: DOMINIO=tiles.maphub.it}"
REPO=/srv/wm-tiles
PORTA=8080
# Il servizio di stampa (oc:9011) NON gira in questa unita': e' un container suo
# (compose.yml), in ascolto sul loopback a questa porta. Caddy ci manda il solo
# percorso /v1/print/*.
PORTA_PRINT=8081
# La copia del codice da cui gira quel container: la crea il workflow di deploy
# (.github/workflows/print.yml), separata da $REPO perche' un checkout la'
# cambierebbe i file sotto il server delle tile, che e' vivo.
REPO_PRINT=/srv/wm-print

IP_SERVER=$(curl -fsS -4 https://ifconfig.me)
IP_DNS=$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}')
[ "$IP_SERVER" = "$IP_DNS" ] || {
  echo "!! $DOMINIO punta a ${IP_DNS:-niente}, il server e' $IP_SERVER: Let's Encrypt fallirebbe" >&2
  exit 1
}

# Il file dei token di stampa non sta nel repo (che e' pubblico): lo crea
# l'operatore, e senza di esso /v1/print/map risponde 401 a tutti — il deploy
# riesce, logga «print: nessun token» e il servizio di stampa resta chiuso.
# Lo legge il CONTAINER della stampa (compose.yml lo monta in sola lettura), non
# questa unita' systemd: da oc:9011 R6 il rendering sta in un processo separato.
mkdir -p /etc/wm-tiles
chmod 700 /etc/wm-tiles
if [ ! -f /etc/wm-tiles/print-tokens.json ]; then
  echo "!! /etc/wm-tiles/print-tokens.json non c'e': /v1/print/map rispondera' 401 a tutti."
  echo "   Per aprirlo a uno shard, sul server:"
  echo "     umask 077; printf '%s' '{\"<token di almeno 24 caratteri>\": {\"shard\": \"maphub\", \"rpm\": 30}}' \\"
  echo "       > /etc/wm-tiles/print-tokens.json"
  echo "     chmod 600 /etc/wm-tiles/print-tokens.json && systemctl restart wm-tiles"
fi

echo "== servizio wm-tiles"
cat > /etc/systemd/system/wm-tiles.service <<EOF
[Unit]
Description=wm-tiles, server delle tile
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$REPO
ExecStart=/usr/bin/node src/server.js
Environment=NODE_ENV=production
Environment=PORT=$PORTA
Environment=HOST=127.0.0.1
# Qui NON c'e' PRINT_TOKENS_PATH: la stampa e' il container di compose.yml
# (oc:9011, R6), e questo processo non deve rendere pagine — altrimenti un
# segfault del modulo nativo porterebbe giu' anche le tile.
# Senza quella variabile `src/server.js` non monta nemmeno il router di stampa:
# /v1/print/map non esiste (404). E' la differenza con la versione precedente,
# dove il router c'era sempre e mancava solo l'autenticazione: la review del
# Task 10 ha avviato questo stesso processo con PRINT_TOKENS_PATH impostato e ha
# ottenuto un PNG in-process. Resta vero che un drop-in systemd che impostasse
# quella variabile sopravvive a un rilancio di questo script, che gestisce solo
# `public-url.conf`: di la' pero' servirebbe anche un file di token, e Caddy
# manda /v1/print al container, non qui.
# Nessun core dump (oc:9011, R11): un segfault del modulo nativo scriverebbe su
# disco la memoria del processo, con dentro le geometrie ricevute dagli shard —
# fra cui sentieri non pubblicati. E' il `ulimit -c 0` del servizio.
LimitCORE=0
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
# Dietro CloudFront il server riceve l'Host dell'origine, non quello pubblico:
# senza PUBLIC_URL lo stile punterebbe all'origine e le tile salterebbero la CDN.
mkdir -p /etc/systemd/system/wm-tiles.service.d
if [ -n "${PUBLIC_URL:-}" ]; then
  cat > /etc/systemd/system/wm-tiles.service.d/public-url.conf <<EOF
# Indirizzo pubblico per gli URL dello stile: dietro CloudFront il server riceve
# l Host dell origine ($DOMINIO), non quello pubblico.
[Service]
Environment=PUBLIC_URL=$PUBLIC_URL
EOF
else
  rm -f /etc/systemd/system/wm-tiles.service.d/public-url.conf
fi
systemctl daemon-reload
systemctl enable wm-tiles >/dev/null
systemctl restart wm-tiles

echo "== riciclo periodico del servizio di stampa"
# R6 chiede il riciclo periodico del processo di rendering, e compose non sa
# schedulare: lo fa un timer. Due ragioni, non una:
#  - il modulo nativo e' quello che un leak ce l'ha per ipotesi (R6);
#  - alla scadenza di R16 una render() di maplibre-native NON si annulla e resta
#    in volo: se non rientra mai, `inFlight` resta pieno e il servizio risponde
#    503 per sempre con il processo vivo e /health che dice «ok». Il riciclo e'
#    l'unica cura che non richiede un supervisore o una rotta nuova.
# Il riavvio e' mite, e perche' lo sia servono tre cose insieme: `init: true`
# (il processo 1 e' tini, che inoltra i segnali), node figlio DIRETTO di tini
# (Dockerfile.print: Xvfb in background e `exec node`, non `exec xvfb-run`) e un
# gestore di SIGTERM che drena (`spegnimentoMite` in src/server.js, che aspetta
# `inFlight`). Con lo `stop_grace_period` da solo il SIGTERM non arrivava
# nemmeno a Node e `docker compose restart` durava 3 s invece di 150, troncando
# i rendering in volo (review del Task 10).
# Il comando sta in uno script e non nell'ExecStart: systemd sostituisce da solo
# i `$VAR` dentro un ExecStart, e un `$C` o un `$(...)` scritti li' arriverebbero
# a sh gia' svuotati. Il compose sta nella copia separata da $REPO, che serve le
# tile: il deploy non deve cambiare i file sotto un processo vivo.
cat > /usr/local/bin/wm-print-recycle <<EOF
#!/bin/sh
# Ricicla il container di stampa (oc:9011, R6). Se non c'e' — deploy non ancora
# fatto — non e' un errore.
set -eu
C=$REPO_PRINT/compose.yml
[ -f "\$C" ] || { echo "nessun compose in $REPO_PRINT: niente da riciclare"; exit 0; }
[ -n "\$(docker compose -f "\$C" ps -q print 2>/dev/null)" ] || {
  echo "container print non attivo: niente da riciclare"; exit 0; }
exec docker compose -f "\$C" restart print
EOF
chmod +x /usr/local/bin/wm-print-recycle
cat > /etc/systemd/system/wm-print-recycle.service <<EOF
[Unit]
Description=Riciclo periodico del container di stampa (oc:9011, R6)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/wm-print-recycle
EOF
cat > /etc/systemd/system/wm-print-recycle.timer <<EOF
[Unit]
Description=Ricicla il container di stampa ogni 6 ore

[Timer]
OnBootSec=30min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now wm-print-recycle.timer >/dev/null

echo "== Caddy"
command -v caddy >/dev/null || apt-get install -y -qq caddy >/dev/null
# i siti degli altri servizi della macchina (wm-routing) stanno in file propri,
# importati qui: rilanciare questo script non li cancella. Il file vuoto evita
# che l'import resti senza corrispondenze.
mkdir -p /etc/caddy/siti
[ -e /etc/caddy/siti/00-vuoto.caddy ] || echo "# segnaposto: i siti veri sono gli altri file *.caddy" > /etc/caddy/siti/00-vuoto.caddy
# solo Let's Encrypt: di serie Caddy, se fallisce, ripiega su ZeroSSL
# Si scrive su un TEMPORANEO, si valida quello e solo se e' valido lo si sposta
# al suo posto. Scrivendo direttamente su /etc/caddy/Caddyfile, con `set -e` una
# validazione fallita lasciava sul disco un Caddyfile rotto e senza ricaricare:
# il Caddy in esecuzione continuava a servire dalla memoria, ma il primo riavvio
# o reboot avrebbe portato giu' TUTTI i siti dell'host, wm-routing compreso.
# `mv` nella stessa partizione e' atomico, quindi non esiste un istante in cui il
# file e' mezzo scritto.
cat > /etc/caddy/Caddyfile.nuovo <<EOF
{
	acme_ca https://acme-v02.api.letsencrypt.org/directory
}

import /etc/caddy/siti/*.caddy

$DOMINIO {
	encode gzip

	# La mappa da stampare (oc:9011) va al container suo, non al server delle
	# tile: e' tutto il senso di R6. Qui c'e' solo l'instradamento e il tetto del
	# corpo — Caddy 2.11.7 non ha il modulo rate_limit, quindi il limite al
	# minuto resta nel servizio, per token (R8).
	# Il percorso ESATTO oltre a quelli sotto: con il solo `/v1/print/*` un
	# `POST /v1/print`, senza barra finale, scavalcava questo blocco e finiva al
	# server delle tile (provato con due backend veri). Oggi la' risponde 404,
	# ma e' lo stesso processo che non deve mai ricevere richieste di stampa.
	@print path /v1/print /v1/print/*
	handle @print {
		# Il tetto di express.json vale solo per un corpo dichiarato JSON: con un
		# Content-Type diverso quel parser non legge niente e il corpo arriva
		# comunque al processo. Qui il tetto vale per QUALUNQUE tipo (R9).
		# 2MiB e' MAX_BODY_BYTES di src/print/limits.js: cambiandone uno, cambiare l'altro.
		request_body {
			max_size 2MiB
		}
		reverse_proxy 127.0.0.1:$PORTA_PRINT
	}

	handle {
		reverse_proxy 127.0.0.1:$PORTA
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile.nuovo --adapter caddyfile >/dev/null || {
  echo "!! il Caddyfile generato non e' valido: lascio quello di prima e non ricarico" >&2
  echo "   il file rifiutato resta in /etc/caddy/Caddyfile.nuovo" >&2
  exit 1
}
mv /etc/caddy/Caddyfile.nuovo /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

echo "== verifica"
for i in $(seq 1 30); do
  curl -fsS -o /dev/null "https://$DOMINIO/health" 2>/dev/null && break
  sleep 2
done
curl -fsS "https://$DOMINIO/health" >/dev/null || {
  echo "!! https://$DOMINIO/health non risponde: journalctl -u caddy -u wm-tiles" >&2
  exit 1
}
echo "   https://$DOMINIO/health risponde"
