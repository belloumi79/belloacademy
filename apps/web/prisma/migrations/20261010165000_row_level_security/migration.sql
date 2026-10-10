-- =============================================================================
-- BelloAcademy — Isolation multi-tenant au niveau des lignes (Row Level Security)
-- =============================================================================
-- Défense en profondeur : en plus du filtrage applicatif (chaque requête Prisma
-- porte `organizationId`), PostgreSQL refuse lui-même toute ligne n'appartenant
-- pas au tenant courant.
--
-- Fonctionnement :
--   1. L'application (rôle `belloacademy_app`) ouvre une transaction et exécute
--      `SELECT set_config('app.organization_id', '<uuid>', true)` via le helper
--      `withTenant()` (apps/web/src/server/db/tenant.ts).
--   2. Chaque table « tenant » porte une policy qui compare `organizationId`
--      à la valeur de la variable de session.
--   3. `FORCE ROW LEVEL SECURITY` garantit que le propriétaire de la table est
--      lui aussi soumis aux policies (les migrations, qui utilisent le rôle
--      propriétaire, doivent donc positionner la variable ou désactiver la
--      policy explicitement — cf. docs/architecture.md).
--
-- Portée volontairement exclue de RLS :
--   * `organizations`    : le tenant est lui-même la ressource (accès filtré
--                          applicativement par la table `memberships`).
--   * tables globales    : `users`, `plans`, `sessions`, `auth_tokens`,
--                          `payment_events`, `jobs`, `email_messages`.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'memberships',
    'membership_invites',
    'categories',
    'courses',
    'sections',
    'lessons',
    'lesson_resources',
    'assets',
    'enrollments',
    'lesson_progress',
    'quizzes',
    'questions',
    'question_options',
    'quiz_attempts',
    'quiz_answers',
    'assignments',
    'assignment_submissions',
    'submission_files',
    'certificates',
    'live_sessions',
    'live_attendance',
    'subscriptions',
    'invoices',
    'usage_counters'
  ];
  -- Tables dont `organizationId` est nullable : on n'applique la policy que
  -- lorsque la colonne est renseignée.
  nullable_org_tables text[] := ARRAY['audit_logs', 'notifications'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = app_current_org_id()) WITH CHECK ("organizationId" = app_current_org_id())',
      t
    );
  END LOOP;

  FOREACH t IN ARRAY nullable_org_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" IS NULL OR "organizationId" = app_current_org_id()) WITH CHECK ("organizationId" IS NULL OR "organizationId" = app_current_org_id())',
      t
    );
  END LOOP;
END
$$;

-- Le rôle applicatif doit pouvoir lire/écrire, mais jamais contourner RLS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'belloacademy_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO belloacademy_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO belloacademy_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO belloacademy_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO belloacademy_app;
  END IF;
END
$$;
