# syntax=docker/dockerfile:1.7
# =============================================================================
# BelloAcademy — image de production (application web + worker de tâches)
#
# Construction (depuis la racine du dépôt) :
#   docker build -f apps/web/Dockerfile -t belloacademy:latest .
#
# L'image embarque l'application Next.js, le client Prisma, le CLI Prisma
# (pour `migrate deploy` au démarrage) et le worker de tâches asynchrones.
#
# Choix : on conserve l'arborescence du monorepo et les dépendances installées
# plutôt que la sortie « standalone » de Next. Cela garde `pnpm worker`,
# `pnpm db:rls` et `prisma migrate deploy` fonctionnels dans le conteneur, au
# prix d'une image plus volumineuse. Voir docs/deployment.md.
# =============================================================================

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME_HARDLINK="false"

# openssl est requis par les moteurs Prisma ; curl sert au HEALTHCHECK ;
# ca-certificates pour les appels HTTPS sortants (SMTP, Stripe, S3).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssl ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

# -----------------------------------------------------------------------------
# Dépendances : mises en cache tant que les manifestes ne changent pas.
# -----------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Construction : génération du client Prisma puis build Next.js.
# -----------------------------------------------------------------------------
FROM deps AS builder

COPY . .

ENV NODE_ENV=production
# Aucune variable réelle n'est nécessaire : `next build` n'exécute pas les
# routes. Les valeurs ci-dessous évitent seulement l'échec de validation.
ENV AUTH_SECRET="build_time_placeholder_secret_32_chars_min" \
    DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    DATABASE_PLATFORM_URL="postgresql://build:build@127.0.0.1:5432/build" \
    MIGRATE_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

RUN pnpm --filter @belloacademy/web exec prisma generate \
    && pnpm --filter @belloacademy/web build \
    && rm -rf apps/web/.next/cache

# -----------------------------------------------------------------------------
# Exécution
# -----------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Utilisateur non privilégié : l'application ne doit jamais tourner en root.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home nextjs

COPY --from=builder --chown=nextjs:nodejs /app /app

# Répertoires d'écriture (stockage local et file d'attente d'e-mails).
RUN mkdir -p /app/apps/web/var/storage /app/apps/web/var/mail \
    && chown -R nextjs:nodejs /app/apps/web/var

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

# tini comme PID 1 : signaux correctement transmis à Next.js / au worker.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/apps/web/scripts/docker-entrypoint.sh"]
CMD ["web"]
