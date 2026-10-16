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

IP_SERVER=$(curl -fsS -4 https://ifconfig.me)
IP_DNS=$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}')
[ "$IP_SERVER" = "$IP_DNS" ] || {
  echo "!! $DOMINIO punta a ${IP_DNS:-niente}, il server e' $IP_SERVER: Let's Encrypt fallirebbe" >&2
  exit 1
}

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

echo "== Caddy"
command -v caddy >/dev/null || apt-get install -y -qq caddy >/dev/null
# i siti degli altri servizi della macchina (wm-routing) stanno in file propri,
# importati qui: rilanciare questo script non li cancella. Il file vuoto evita
# che l'import resti senza corrispondenze.
mkdir -p /etc/caddy/siti
[ -e /etc/caddy/siti/00-vuoto.caddy ] || echo "# segnaposto: i siti veri sono gli altri file *.caddy" > /etc/caddy/siti/00-vuoto.caddy
# solo Let's Encrypt: di serie Caddy, se fallisce, ripiega su ZeroSSL
cat > /etc/caddy/Caddyfile <<EOF
{
	acme_ca https://acme-v02.api.letsencrypt.org/directory
}

import /etc/caddy/siti/*.caddy

$DOMINIO {
	encode gzip
	reverse_proxy 127.0.0.1:$PORTA
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
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
