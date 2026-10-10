-- BelloAcademy — initialisation des rôles et bases PostgreSQL
--
-- Deux rôles distincts :
--   * OWNER  : propriétaire des objets, utilisé uniquement par les migrations/DDL.
--   * APP    : rôle applicatif utilisé à l'exécution. Non propriétaire des tables,
--              sans BYPASSRLS => les politiques Row Level Security s'appliquent.
--
-- Exécution (local ou conteneur) :
--   psql "postgresql://postgres@localhost:5432/postgres" -v owner_pw='...' -v app_pw='...' -f infra/sql/init-db.sql

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE belloacademy_owner LOGIN PASSWORD %L', :'owner_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'belloacademy_owner') \gexec
SELECT format('CREATE ROLE belloacademy_app LOGIN PASSWORD %L', :'app_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'belloacademy_app') \gexec

-- Le rôle propriétaire (migrations, seed, opérations « plateforme ») peut
-- contourner les politiques RLS : c'est le rôle d'administration. Le rôle
-- applicatif, lui, y est strictement soumis (voir infra/sql/rls.sql).
ALTER ROLE belloacademy_owner NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
ALTER ROLE belloacademy_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

SELECT 'CREATE DATABASE belloacademy OWNER belloacademy_owner'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'belloacademy') \gexec
SELECT 'CREATE DATABASE belloacademy_shadow OWNER belloacademy_owner'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'belloacademy_shadow') \gexec
SELECT 'CREATE DATABASE belloacademy_test OWNER belloacademy_owner'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'belloacademy_test') \gexec

\connect belloacademy
GRANT CONNECT ON DATABASE belloacademy TO belloacademy_app;
GRANT USAGE ON SCHEMA public TO belloacademy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO belloacademy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO belloacademy_app;

\connect belloacademy_shadow
GRANT CONNECT ON DATABASE belloacademy_shadow TO belloacademy_app;
GRANT USAGE ON SCHEMA public TO belloacademy_app;

\connect belloacademy_test
GRANT CONNECT ON DATABASE belloacademy_test TO belloacademy_app;
GRANT USAGE ON SCHEMA public TO belloacademy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO belloacademy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO belloacademy_app;

-- Rôle « plateforme » : utilisé par les opérations légitimement inter-organisations
-- (superadministration, facturation, résolution des appartenances à la connexion).
-- Il porte BYPASSRLS : il contourne donc les politiques RLS. Il ne doit JAMAIS
-- être utilisé pour servir une requête d'un utilisateur final.
SELECT 'CREATE ROLE belloacademy_platform LOGIN BYPASSRLS PASSWORD ''belloacademy_platform_dev'''
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'belloacademy_platform') \gexec
ALTER ROLE belloacademy_platform NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

\connect belloacademy
GRANT CONNECT ON DATABASE belloacademy TO belloacademy_platform;
GRANT USAGE ON SCHEMA public TO belloacademy_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO belloacademy_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO belloacademy_platform;

\connect belloacademy_shadow
GRANT CONNECT ON DATABASE belloacademy_shadow TO belloacademy_platform;
GRANT USAGE ON SCHEMA public TO belloacademy_platform;

\connect belloacademy_test
GRANT CONNECT ON DATABASE belloacademy_test TO belloacademy_platform;
GRANT USAGE ON SCHEMA public TO belloacademy_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO belloacademy_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE belloacademy_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO belloacademy_platform;
