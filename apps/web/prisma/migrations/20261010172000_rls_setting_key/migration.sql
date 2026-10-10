-- =============================================================================
-- BelloAcademy — clé de contexte de tenant
-- =============================================================================
-- Le helper applicatif `withTenant()` (apps/web/src/lib/db/prisma.ts) positionne
-- la variable de session `app.current_org_id`. La fonction d'isolation lit
-- désormais la même clé : sans cette correction, aucune ligne n'aurait été
-- visible dans un contexte de tenant.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;
