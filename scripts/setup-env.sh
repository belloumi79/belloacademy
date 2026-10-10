#!/usr/bin/env bash
# Génère apps/web/.env (et .env racine pour docker compose) à partir de .env.example.
# Idempotent : n'écrase jamais un .env existant sans --force.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="$ROOT_DIR/.env.example"
TARGET="$ROOT_DIR/apps/web/.env"
FORCE="${1:-}"

if [ ! -f "$EXAMPLE" ]; then
  echo "Fichier .env.example introuvable : $EXAMPLE" >&2
  exit 1
fi

write_env() {
  local dest="$1"
  if [ -f "$dest" ] && [ "$FORCE" != "--force" ]; then
    echo "Conservé (déjà présent) : $dest"
    return
  fi
  local secret
  secret="$(openssl rand -base64 48 | tr -d '\n')"
  sed "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$secret\"|" "$EXAMPLE" > "$dest"
  echo "Écrit : $dest"
}

write_env "$TARGET"
# Le fichier racine est utilisé par docker compose (substitutions ${VAR}).
write_env "$ROOT_DIR/.env"

echo "Terminé. Vérifiez les valeurs CHANGEZ_MOI restantes."
