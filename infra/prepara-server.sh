#!/usr/bin/env bash
# Prepara un server Ubuntu (24.04 o 26.04) per wm-tiles. Si lancia come root sul
# server, dal Mac:
#
#   ssh wm-tiles 'bash -s' < infra/prepara-server.sh
#
# Si puo' rilanciare: ogni passo controlla se e' gia' fatto. Cosa fa e perche':
# - aggiornamenti del sistema (gli aggiornamenti di sicurezza automatici sono
#   gia' attivi nelle immagini Ubuntu);
# - swap di 8 GB: le immagini Hetzner non ne hanno, e senza swap un picco di
#   memoria (planetiler, l'import di GraphHopper) fa chiudere un processo;
# - Docker e Compose dai pacchetti Ubuntu: tutte le pipeline girano in container;
# - Node.js per il server delle tile e gli strumenti; aws CLI v2 per S3;
# - SSH solo con chiave, firewall con le sole porte 22, 80 e 443. ATTENZIONE:
#   Docker scavalca ufw per le porte pubblicate dai container, quindi un
#   container si pubblica su 127.0.0.1 (`-p 127.0.0.1:8989:8989`) e si espone
#   dal reverse proxy;
# - /data sul Volume (dati che restano), il repo in /srv/wm-tiles con `data`
#   che punta li'. I lavori temporanei e pesanti restano sul disco locale.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
REPO_URL="${REPO_URL:-https://github.com/webmappsrl/wm-tiles.git}"
BRANCH="${BRANCH:-main}"
VOLUME="${VOLUME:-$(findmnt -rn -o TARGET | grep '^/mnt/HC_Volume_' | head -1 || true)}"
[ -n "$VOLUME" ] || { echo "!! nessun Volume Hetzner montato: passalo con VOLUME=/percorso" >&2; exit 1; }

echo "== aggiornamenti e pacchetti di base"
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade >/dev/null
apt-get install -y -qq ca-certificates curl unzip jq rsync git python3 ufw \
  docker.io docker-compose-v2 docker-buildx nodejs npm >/dev/null
systemctl enable --now docker >/dev/null

echo "== strumenti che le pipeline usano sul sistema: osmium, tippecanoe, pmtiles"
# le stesse versioni del Mac su cui le pipeline sono provate (tippecanoe: Ubuntu ha la 2.53)
TIPPECANOE=2.79.0
PMTILES=1.31.2
apt-get install -y -qq osmium-tool python3-yaml build-essential libsqlite3-dev zlib1g-dev >/dev/null
if [ "$(tippecanoe --version 2>&1 | grep -o '[0-9.]*$' || true)" != "$TIPPECANOE" ]; then
  T=$(mktemp -d)
  curl -fsSL "https://github.com/felt/tippecanoe/archive/refs/tags/$TIPPECANOE.tar.gz" | tar -xz -C "$T"
  make -s -C "$T/tippecanoe-$TIPPECANOE" -j"$(nproc)" >/dev/null 2>&1
  make -s -C "$T/tippecanoe-$TIPPECANOE" install PREFIX=/usr/local >/dev/null
  rm -rf "$T"
fi
if ! pmtiles version 2>/dev/null | grep -q "$PMTILES"; then
  ARCH=$(uname -m | sed 's/aarch64/arm64/')
  curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES/go-pmtiles_${PMTILES}_Linux_$ARCH.tar.gz" \
    | tar -xz -C /usr/local/bin pmtiles
fi

echo "== swap"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
# lo swap e' un margine, non memoria: lo si usa solo quando serve davvero
echo 'vm.swappiness=10' > /etc/sysctl.d/90-wm-tiles.conf
sysctl -q -p /etc/sysctl.d/90-wm-tiles.conf

echo "== aws CLI v2"
if ! command -v aws >/dev/null; then
  T=$(mktemp -d)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "$T/aws.zip"
  unzip -q "$T/aws.zip" -d "$T" && "$T/aws/install" >/dev/null
  rm -rf "$T"
fi

echo "== SSH solo con chiave"
cat > /etc/ssh/sshd_config.d/10-wm-tiles.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
# con l'avvio a socket di Ubuntu 24.04+ /run/sshd non esiste finche' sshd non parte,
# e senza `sshd -t` fallisce: il controllo salterebbe e la configurazione resterebbe inattiva
mkdir -p /run/sshd
sshd -t
systemctl reload-or-restart ssh

echo "== firewall: 22, 80, 443"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== cartelle: repo in /srv/wm-tiles, il suo data/ e' il Volume"
ln -sfn "$VOLUME" /data   # comodo da shell
mkdir -p "$VOLUME/wm-tiles"
if [ ! -d /srv/wm-tiles/.git ]; then
  git clone -q --branch "$BRANCH" "$REPO_URL" /srv/wm-tiles
fi
# Un mount, non un link simbolico: le pipeline montano il repo nei container,
# e dentro un container un link che punta fuori dal repo non porta da nessuna
# parte ("Unable to open datasource"). I mount invece si vedono.
[ -L /srv/wm-tiles/data ] && rm /srv/wm-tiles/data
mkdir -p /srv/wm-tiles/data
grep -q " /srv/wm-tiles/data " /etc/fstab \
  || echo "$VOLUME/wm-tiles /srv/wm-tiles/data none bind,nofail,x-systemd.requires-mounts-for=$VOLUME 0 0" >> /etc/fstab
systemctl daemon-reload
mountpoint -q /srv/wm-tiles/data || mount /srv/wm-tiles/data
cd /srv/wm-tiles
npm ci --no-audit --no-fund --loglevel=error
# i glifi dei font non stanno nel repo (circa 100 MB): senza, maplibre-native
# non scrive nessuna etichetta nei PNG, e la preview chiede font che non ci sono
[ -d style/glyphs/"Noto Sans Regular" ] || bash pipeline/get-glyphs.sh >/dev/null

echo "== immagine del renderer PNG"
docker build -q -t wm-render-png -f pipeline/render-png.Dockerfile pipeline >/dev/null

echo "== fatto"
. /etc/os-release
echo "   $PRETTY_NAME, Docker $(docker --version | awk '{print $3}' | tr -d ,), Node $(node --version), $(aws --version 2>&1 | awk '{print $1}')"
echo "   osmium $(osmium --version | head -1 | awk '{print $NF}'), tippecanoe $(tippecanoe --version 2>&1 | grep -o '[0-9.]*$'), pmtiles $(pmtiles version 2>&1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*' | head -1)"
echo "   swap $(swapon --show=SIZE --noheadings | head -1), data/ = $VOLUME/wm-tiles, repo $(git -C /srv/wm-tiles rev-parse --abbrev-ref HEAD)@$(git -C /srv/wm-tiles rev-parse --short HEAD)"
[ -f /var/run/reboot-required ] && echo "   serve un riavvio per il kernel aggiornato: reboot" || true
