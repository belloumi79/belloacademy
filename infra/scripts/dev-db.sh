#!/usr/bin/env bash
# =============================================================================
# BelloAcademy — provisionnement de la base PostgreSQL locale
#
# Crée les trois rôles (owner / app / platform) et les bases de développement,
# de test et « shadow », puis applique les privilèges par défaut.
#
# Le script est IDEMPOTENT : le relancer ne détruit aucune donnée.
#
# Usage :
#   bash infra/scripts/dev-db.sh
#
# Variables reconnues :
#   PGHOST, PGPORT            (défaut : 127.0.0.1:5432)
#   PGSUPERUSER               (défaut : postgres)
#   PGSUPERUSER_URL           URL complète du rôle d'administration
#                             (défaut : postgresql://$PGSUPERUSER@$PGHOST:$PGPORT/postgres)
#   OWNER_PASSWORD            (défaut : belloacademy_owner_dev)
#   APP_PASSWORD              (défaut : belloacademy_app_dev)
#   PLATFORM_PASSWORD         (défaut : belloacademy_platform_dev)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$(cd "${SCRIPT_DIR}/../sql" && pwd)"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGSUPERUSER="${PGSUPERUSER:-postgres}"
PGSUPERUSER_URL="${PGSUPERUSER_URL:-postgresql://${PGSUPERUSER}@${PGHOST}:${PGPORT}/postgres}"

OWNER_PASSWORD="${OWNER_PASSWORD:-belloacademy_owner_dev}"
APP_PASSWORD="${APP_PASSWORD:-belloacademy_app_dev}"
PLATFORM_PASSWORD="${PLATFORM_PASSWORD:-belloacademy_platform_dev}"

log() { printf '\033[36m→\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }
ok() { printf '\033[32m✓\033[0m %s\n' "$1"; }

command -v psql >/dev/null 2>&1 || fail "psql est introuvable. Installez le client PostgreSQL."

# --- Connexion d'administration ----------------------------------------------
# Selon l'installation, le rôle « postgres » est joignable directement (TCP +
# mot de passe) ou uniquement via le socket Unix du système. On teste les deux.
run_admin() {
  psql "${PGSUPERUSER_URL}" -v ON_ERROR_STOP=1 "$@"
}

if ! run_admin -c 'SELECT 1' >/dev/null 2>&1; then
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    log "Connexion TCP impossible — bascule sur le socket local via l'utilisateur système « postgres »."
    run_admin() {
      su postgres -c "psql -v ON_ERROR_STOP=1 $(printf '%q ' "$@")"
    }
  else
    fail "Impossible de se connecter à PostgreSQL (${PGSUPERUSER_URL}). Vérifiez que le serveur tourne et que le rôle d'administration existe."
  fi
fi

if ! run_admin -c 'SELECT 1' >/dev/null 2>&1; then
  fail "Connexion d'administration PostgreSQL toujours indisponible."
fi

# --- Rôles et bases ----------------------------------------------------------
# Une seule passe psql : les bases n'existent pas encore, donc les GRANT par
# base sont gérés par ce script après création (voir ci-dessous).
log "Création des rôles et des bases (idempotent)…"

create_role() {
  local role="$1" password="$2" bypass="$3"
  run_admin -q -c "DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
      CREATE ROLE ${role} LOGIN PASSWORD '${password}'${bypass};
    ELSE
      ALTER ROLE ${role} LOGIN PASSWORD '${password}'${bypass};
    END IF;
  END
  \$\$;"
}

create_role belloacademy_owner    "${OWNER_PASSWORD}"    " BYPASSRLS"
create_role belloacademy_app      "${APP_PASSWORD}"      " NOBYPASSRLS"
create_role belloacademy_platform "${PLATFORM_PASSWORD}" " BYPASSRLS"

run_admin -q -c "ALTER ROLE belloacademy_owner NOSUPERUSER NOCREATEDB NOCREATEROLE;"
run_admin -q -c "ALTER ROLE belloacademy_app NOSUPERUSER NOCREATEDB NOCREATEROLE;"
run_admin -q -c "ALTER ROLE belloacademy_platform NOSUPERUSER NOCREATEDB NOCREATEROLE;"

# CREATE DATABASE ne peut pas s'exécuter dans un bloc transactionnel : on teste
# l'existence côté shell, puis on crée si nécessaire.
create_db() {
  local db="$1"
  local exists
  exists="$(run_admin -Atc "SELECT 1 FROM pg_database WHERE datname = '${db}'" | tr -d '[:space:]')"
  if [ "${exists}" = "1" ]; then
    return 0
  fi
  run_admin -q -c "CREATE DATABASE ${db} OWNER belloacademy_owner"
  log "Base « ${db} » créée."
}

create_db belloacademy
create_db belloacademy_shadow
create_db belloacademy_test
create_db belloacademy_test_shadow

ok "Rôles et bases créés."

# --- Privilèges par défaut ---------------------------------------------------
# Les privilèges sur les tables existantes sont accordés APRÈS les migrations :
# `ALTER DEFAULT PRIVILEGES` ne couvre que les objets créés ensuite.
log "Application des privilèges par défaut…"

for db in belloacademy belloacademy_test; do
  run_admin -q -d "$db" -c "
    GRANT CONNECT ON DATABASE ${db} TO belloacademy_app, belloacademy_platform;
    GRANT USAGE ON SCHEMA public TO belloacademy_app, belloacademy_platform;
    ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO belloacademy_app, belloacademy_platform;
    ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO belloacademy_app, belloacademy_platform;
  "
  # Si des tables existent déjà (ré-exécution du script), on les couvre aussi.
  run_admin -q -d "$db" -c "
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
      TO belloacademy_app, belloacademy_platform;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
      TO belloacademy_app, belloacademy_platform;
  " || true
done

for db in belloacademy_shadow belloacademy_test_shadow; do
  run_admin -q -d "$db" -c "
    GRANT CONNECT ON DATABASE ${db} TO belloacademy_app, belloacademy_platform;
    GRANT USAGE ON SCHEMA public TO belloacademy_app, belloacademy_platform;
  "
done

ok "Base de données prête."
cat <<EOF

Étape suivante :
  bash scripts/setup-env.sh     # crée apps/web/.env depuis .env.example
  pnpm db:migrate               # applique les migrations
  pnpm db:rls                   # active Row Level Security
  pnpm db:seed                  # données de démonstration

URL de développement :
  postgresql://belloacademy_app:${APP_PASSWORD}@${PGHOST}:${PGPORT}/belloacademy

Pour supprimer les bases de test :
  dropdb --if-exists belloacademy_test && dropdb --if-exists belloacademy_test_shadow

EOF
