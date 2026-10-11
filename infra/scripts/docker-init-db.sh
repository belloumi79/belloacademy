#!/usr/bin/env bash
# =============================================================================
# BelloAcademy — amorçage PostgreSQL dans un conteneur
#
# Exécuté automatiquement par l'image officielle `postgres` lors de la PREMIÈRE
# initialisation du volume de données (/docker-entrypoint-initdb.d). Il crée les
# trois rôles applicatifs et les bases de développement.
#
# Ne s'exécute jamais sur un volume déjà initialisé : pour rejouer l'amorçage,
# supprimez le volume (`docker compose down -v`) en ayant conscience de la perte
# de données.
#
# Les mots de passe proviennent de l'environnement du conteneur : aucun secret
# n'est écrit en dur dans le dépôt.
# =============================================================================

set -euo pipefail

: "${OWNER_PASSWORD:?OWNER_PASSWORD est requis}"
: "${APP_PASSWORD:?APP_PASSWORD est requis}"
: "${PLATFORM_PASSWORD:?PLATFORM_PASSWORD est requis}"

SQL_DIR="/bootstrap-sql"
INIT_SQL="${SQL_DIR}/init-db.sql"

if [ ! -f "${INIT_SQL}" ]; then
  echo "✗ ${INIT_SQL} introuvable : le volume ./infra/sql n'est pas monté." >&2
  exit 1
fi

echo "→ Création des rôles, des bases et des privilèges BelloAcademy…"

psql --no-psqlrc -q -v ON_ERROR_STOP=1 \
  -v owner_pw="${OWNER_PASSWORD}" \
  -v app_pw="${APP_PASSWORD}" \
  -v platform_pw="${PLATFORM_PASSWORD}" \
  -f "${INIT_SQL}"

echo "✓ Amorçage PostgreSQL terminé (bases : belloacademy, belloacademy_shadow, belloacademy_test)."
