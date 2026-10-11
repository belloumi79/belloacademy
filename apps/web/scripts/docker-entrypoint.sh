#!/usr/bin/env bash
# =============================================================================
# BelloAcademy — point d'entrée du conteneur applicatif
#
# Rôles :
#   1. attendre que PostgreSQL accepte les connexions ;
#   2. appliquer les migrations (`prisma migrate deploy`) et, si demandé, les
#      politiques Row Level Security ;
#   3. lancer soit le serveur web, soit le worker de tâches.
#
# Usage (positional) :
#   docker-entrypoint.sh web                 -> serveur Next.js
#   docker-entrypoint.sh worker              -> worker de tâches
#   docker-entrypoint.sh <commande> [args]   -> commande arbitraire
#
# Variables :
#   RUN_MIGRATIONS_ON_START  (défaut true)  applique les migrations au démarrage
#   RUN_RLS_ON_START         (défaut true)  rejoue les politiques RLS
#   DB_WAIT_TIMEOUT_SECONDS  (défaut 90)    délai maximal d'attente de la base
#
# Le worker ne doit PAS appliquer les migrations : un seul service les applique.
# =============================================================================

set -euo pipefail

APP_DIR="/app/apps/web"
LOG_PREFIX="[belloacademy]"

log() { printf '%s %s\n' "${LOG_PREFIX}" "$*"; }
fail() { printf '%s ERREUR : %s\n' "${LOG_PREFIX}" "$*" >&2; exit 1; }

: "${MIGRATE_DATABASE_URL:?MIGRATE_DATABASE_URL est requis pour appliquer les migrations}"

# --- 1. Attente de PostgreSQL -------------------------------------------------
# On interroge `prisma migrate status`, qui ouvre une vraie connexion : plus
# fiable qu'un simple test de port TCP.
wait_for_database() {
  local timeout="${DB_WAIT_TIMEOUT_SECONDS:-90}"
  local elapsed=0
  log "Attente de PostgreSQL (max ${timeout}s)…"
  until pnpm --dir "${APP_DIR}" exec prisma migrate status >/dev/null 2>&1; do
    if [ "${elapsed}" -ge "${timeout}" ]; then
      fail "PostgreSQL injoignable après ${timeout}s (${MIGRATE_DATABASE_URL%%\?*})."
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  log "PostgreSQL est disponible."
}

# --- 2. Migrations et RLS ----------------------------------------------------
apply_migrations() {
  if [ "${RUN_MIGRATIONS_ON_START:-true}" != "true" ]; then
    log "RUN_MIGRATIONS_ON_START != true : migrations ignorées."
    return 0
  fi
  log "Application des migrations Prisma…"
  pnpm --dir "${APP_DIR}" exec prisma migrate deploy

  if [ "${RUN_RLS_ON_START:-true}" = "true" ]; then
    log "Application des politiques Row Level Security…"
    # `pnpm db:rls` rejoue infra/sql/rls.sql de façon idempotente. Un échec ici
    # ne doit pas empêcher le démarrage : les politiques sont déjà créées par la
    # migration, ce script ne sert qu'aux bases restaurées hors Prisma.
    pnpm --dir "${APP_DIR}" run db:rls \
      || log "AVERTISSEMENT : application RLS en échec — vérifiez infra/sql/rls.sql."
  fi
}

# --- 3. Démarrage -------------------------------------------------------------
main() {
  local command="${1:-web}"

  case "${command}" in
    web)
      wait_for_database
      apply_migrations
      log "Démarrage du serveur web sur ${HOSTNAME:-0.0.0.0}:${PORT:-3000}…"
      exec pnpm --dir "${APP_DIR}" exec next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
      ;;
    worker)
      wait_for_database
      log "Démarrage du worker de tâches asynchrones…"
      exec pnpm --dir "${APP_DIR}" run worker
      ;;
    *)
      # Commande explicite : on ne présume rien (ex. `migrate`, `seed`, shell).
      exec "$@"
      ;;
  esac
}

main "$@"
