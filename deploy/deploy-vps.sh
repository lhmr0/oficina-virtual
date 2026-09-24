#!/usr/bin/env bash
# Publica el último commit en el VPS (ssh vps) y reinicia el contenedor. Uso: bash deploy/deploy-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git diff --quiet HEAD -- . ':!data' || { echo "Hay cambios sin commit; haz commit antes de desplegar."; exit 1; }
echo "→ subiendo $(git rev-parse --short HEAD)"
git archive --format=tar HEAD | ssh vps 'mkdir -p ~/oficina/app ~/oficina/data && find ~/oficina/app -mindepth 1 -delete && tar -x -C ~/oficina/app'
ssh vps "FORCE=${FORCE:-} bash -s" <<'REMOTE'
set -euo pipefail
cd ~/oficina
docker build -q -t oficina-virtual:latest app >/dev/null
if [ ! -f .env ] || ! grep -q '^GOOGLE_CLIENT_SECRET=..*' .env; then
  echo "⚠ Falta ~/oficina/.env con GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET: imagen lista, contenedor NO iniciado."; exit 0
fi
# reiniciar corta los runs en curso: esperar a que terminen (FORCE=1 para no esperar)
busy() { docker exec oficina-virtual node --no-warnings -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('/data/oficina.db').prepare('select count(*) n from runs where ended_at is null').get().n)" 2>/dev/null || echo 0; }
if [ -z "${FORCE:-}" ]; then
  while [ "$(busy)" != "0" ]; do echo "… $(busy) ejecución(es) en curso; espero a que terminen (Ctrl+C para cancelar, FORCE=1 para no esperar)"; sleep 20; done
fi
docker rm -f oficina-virtual >/dev/null 2>&1 || true
docker run -d --name oficina-virtual --restart unless-stopped -p 127.0.0.1:4242:4242 -v ~/oficina/data:/data --env-file .env oficina-virtual:latest >/dev/null
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:4242/api/setup >/dev/null 2>&1 && { echo "✔ oficina-virtual arriba"; exit 0; }; sleep 1; done
echo "✘ no respondió"; docker logs --tail 30 oficina-virtual; exit 1
REMOTE
