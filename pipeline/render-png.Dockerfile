# render-png.mjs su Linux: maplibre-native con OpenGL in software (Mesa
# llvmpipe) dentro Xvfb, cosi' gira su un server senza GPU. Il binario
# precompilato di maplibre-native 6.2.0 e' costruito su Ubuntu 22.04 e vuole
# le sue librerie (ICU 70): l'immagine le fissa, e il sistema del server non
# conta. Cambiando versione di maplibre-native va ricontrollato con `ldd`.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils xvfb xauth libglfw3 libuv1 libjpeg-turbo8 libicu70 \
      libopengl0 libcurl4 libpng16-16 libwebp7 libgl1-mesa-dri libglx-mesa0 libegl1 libgles2 \
    && rm -rf /var/lib/apt/lists/*
ARG NODE=20.18.1
RUN ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/') \
    && curl -fsSL https://nodejs.org/dist/v$NODE/node-v$NODE-linux-$ARCH.tar.xz | tar -xJ -C /opt \
    && ln -s /opt/node-v$NODE-linux-$ARCH/bin/node /usr/local/bin/node \
    && ln -s /opt/node-v$NODE-linux-$ARCH/bin/npm /usr/local/bin/npm
# le sole dipendenze del renderer; il codice si monta da fuori (render-png-docker.sh)
WORKDIR /repo
RUN npm init -y >/dev/null && npm install --no-audit --no-fund @maplibre/maplibre-gl-native@6.2.0 sharp@0.34.5
