-- BelloAcademy — privilèges du rôle applicatif
--
-- Le rôle applicatif (`belloacademy_app`) n'est PAS propriétaire des tables : c'est
-- ce qui permet aux politiques Row Level Security (voir la migration
-- `row_level_security`) de s'appliquer réellement à l'exécution.
--
-- Cette migration est idempotente et sans effet si le rôle applicatif n'existe pas
-- (par exemple sur une base de développement jetable) : elle ne casse donc pas
-- `prisma migrate deploy` dans un environnement où le rôle serait nommé autrement.

DO $$
DECLARE
  app_role text := 'belloacademy_app';
  owner_role text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'Rôle % absent : privilèges applicatifs non appliqués.', app_role;
    RETURN;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);

  -- Les tables créées par les migrations futures hériteront automatiquement de ces droits.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    owner_role, app_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
    owner_role, app_role
  );
END $$;
