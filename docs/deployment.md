# Déploiement — BelloAcademy

Ce document décrit la mise en production de BelloAcademy : prérequis, variables
d'environnement, migrations, sauvegardes, supervision, mises à jour et dépannage.

Pour l'architecture interne, voir [`architecture.md`](architecture.md). Pour
Jitsi Meet, voir [`jitsi.md`](jitsi.md).

---

## 1. Prérequis serveur

| Élément | Minimum | Recommandé |
| --- | --- | --- |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 Go | 8 Go |
| Disque | 40 Go SSD | 100 Go SSD |
| Système | Linux x86_64, Docker 24+, Compose v2 | Debian 12 / Ubuntu 22.04+ |
| Réseau | 80/tcp, 443/tcp | + 10000/udp si Jitsi auto-hébergé |

Avec le profil `jitsi` (visioconférence auto-hébergée), prévoyez 2 vCPU et 2 Go
supplémentaires : `jvb` (le pont vidéo) est le composant le plus gourmand.

Un nom de domaine avec deux enregistrements DNS de type `A` pointant vers le
serveur :

```
academy.example.tn   → SITE_DOMAIN        (plateforme)
meet.example.tn      → JITSI_SITE_ADDRESS (Jitsi, profil « jitsi » uniquement)
```

Les certificats TLS sont obtenus automatiquement par Caddy (Let's Encrypt) dès
que le DNS est propagé et que les ports 80 et 443 sont accessibles depuis
Internet.

---

## 2. Première mise en production

### 2.1 Récupérer le code et les dépendances

```bash
git clone https://github.com/belloumi79/belloacademy.git
cd belloacademy
pnpm install --frozen-lockfile
```

### 2.2 Créer le fichier d'environnement

```bash
cp .env.example .env
```

Puis renseigner **obligatoirement** ces valeurs (aucun secret n'a de valeur par
défaut utilisable en production) :

```bash
AUTH_SECRET="$(openssl rand -base64 48)"
POSTGRES_SUPERUSER_PASSWORD="$(openssl rand -base64 24)"
OWNER_PASSWORD="$(openssl rand -base64 24)"
APP_PASSWORD="$(openssl rand -base64 24)"
PLATFORM_PASSWORD="$(openssl rand -base64 24)"
S3_ACCESS_KEY_ID="$(openssl rand -hex 12)"
S3_SECRET_ACCESS_KEY="$(openssl rand -base64 32)"
APP_URL="https://academy.example.tn"
SITE_DOMAIN="academy.example.tn"
```

Compose refuse de démarrer si `AUTH_SECRET`, `POSTGRES_SUPERUSER_PASSWORD`,
`S3_ACCESS_KEY_ID` ou `S3_SECRET_ACCESS_KEY` sont absents : c'est volontaire, ces
variables n'ont pas de repli sûr.

### 2.3 Démarrer la pile

```bash
# Pile applicative seule (http://localhost:3000)
docker compose up -d

# Avec reverse proxy Caddy et HTTPS automatique
docker compose --profile proxy up -d

# Avec classes virtuelles Jitsi Meet auto-hébergées
CADDYFILE=Caddyfile.jitsi docker compose --profile proxy --profile jitsi up -d
```

Au premier démarrage, le conteneur `web` :

1. attend que PostgreSQL accepte les connexions (`prisma migrate status`, qui
   ouvre une vraie connexion) ;
2. applique `prisma migrate deploy` (rôle `belloacademy_owner`) ;
3. rejoue les politiques Row Level Security (`infra/sql/rls.sql`) ;
4. démarre `next start`.

Le conteneur `worker` traite ensuite la file de tâches (`jobs`) : e-mails,
rappels de classes virtuelles, échéances d'abonnement, instantanés de
consommation.

### 2.4 Vérifier le démarrage

```bash
curl -s https://academy.example.tn/api/health | jq
```

La sonde renvoie `200` avec `"status": "ok"` lorsque la base, le stockage, Jitsi
et la file de tâches répondent. Elle renvoie `503` avec `"status": "degraded"`
sinon, en détaillant le composant fautif :

```json
{
  "status": "ok",
  "version": "0.1.0",
  "checks": {
    "database": { "ok": true },
    "storage": { "ok": true, "detail": "s3" },
    "jitsi": { "ok": true, "detail": "meet.example.tn" },
    "jobs": { "ok": true, "detail": "pending=0 failed=0 dead=0" }
  }
}
```

### 2.5 Amorcer les données

En production, le seed refuse de créer les comptes de démonstration (leurs
identifiants sont publics). Deux options :

```bash
# Option 1 (recommandée) : uniquement un superadministrateur
SEED_SUPER_ADMIN_EMAIL="vous@example.tn" \
SEED_SUPER_ADMIN_PASSWORD="<mot de passe respectant la politique>" \
docker compose exec web pnpm --dir /app/apps/web run db:seed

# Option 2 : forcer les données de démonstration (environnement jetable)
SEED_ALLOW_PRODUCTION="true" docker compose exec web pnpm --dir /app/apps/web run db:seed
```

Le mot de passe doit contenir au moins 10 caractères, une majuscule, une
minuscule, un chiffre et un caractère spécial.

---

## 3. Variables d'environnement

### Application

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NODE_ENV` | `production` | Mode d'exécution |
| `APP_NAME` | `BelloAcademy` | Nom affiché |
| `APP_URL` | `http://localhost:3000` | URL publique ; sert aux liens des e-mails |
| `DEFAULT_LOCALE` | `fr` | Langue par défaut |
| `DEFAULT_TIMEZONE` | `Africa/Tunis` | Fuseau par défaut des sessions |
| `DEFAULT_CURRENCY` | `TND` | Devise d'affichage |
| `AUTH_SECRET` | — | **Obligatoire.** Signature des sessions et des jetons |
| `SESSION_TTL_HOURS` | `720` | Durée de vie d'une session (30 jours) |

### Base de données

Trois rôles PostgreSQL aux privilèges distincts, créés par
`infra/scripts/docker-init-db.sh` au premier démarrage du volume :

| Variable | Rôle | Particularité |
| --- | --- | --- |
| `MIGRATE_DATABASE_URL` | `belloacademy_owner` | Migrations ; porte `BYPASSRLS` |
| `DATABASE_URL` | `belloacademy_app` | Requêtes applicatives ; `NOBYPASSRLS`, RLS actif |
| `DATABASE_PLATFORM_URL` | `belloacademy_platform` | Opérations inter-organisations ; porte `BYPASSRLS` |

`DATABASE_PLATFORM_URL` ne doit être utilisé que pour les traitements réellement
transverses (facturation, tâches planifiées, superadministrateur). Le code
applicatif passe par `withTenant()`, qui fixe `app.current_org_id` dans la
transaction et laisse PostgreSQL filtrer les lignes.

### Stockage

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `STORAGE_DRIVER` | `s3` | `s3` (MinIO/S3) ou `local` (disque) |
| `S3_ENDPOINT` | `http://minio:9000` | Point d'accès S3 |
| `S3_BUCKET` | `belloacademy` | Bucket applicatif |
| `S3_ACCESS_KEY_ID` | — | **Obligatoire** |
| `S3_SECRET_ACCESS_KEY` | — | **Obligatoire** |
| `S3_FORCE_PATH_STYLE` | `true` | Nécessaire pour MinIO |

### Jitsi, e-mail, paiements, exploitation

Voir respectivement [`jitsi.md`](jitsi.md) et les sections `# --- E-mail`,
`# --- Paiements`, `# --- Exploitation` de `.env.example`. En résumé :

- `MAIL_DRIVER` : `console` (spool sur disque, développement), `smtp` (SMTP réel)
  ou `file`. `console` permet de tester localement sans service payant.
- `BILLING_PROVIDER` : `mock` (développement, aucun débit réel) ou `stripe`.
- `RATE_LIMIT_ENABLED`, `TRUST_PROXY` : limitation de débit et lecture de
  `X-Forwarded-For` derrière un proxy de confiance.

---

## 4. Migrations

```bash
# En développement : crée et applique une migration
pnpm db:migrate

# En production : applique les migrations en attente, sans en créer
pnpm db:deploy

# Rejouer les politiques RLS (idempotent)
pnpm db:rls
```

En production, `prisma migrate deploy` est exécuté automatiquement au démarrage
du conteneur `web` (`RUN_MIGRATIONS_ON_START=true`). Pour désactiver ce
comportement et appliquer les migrations manuellement :

```bash
RUN_MIGRATIONS_ON_START=false RUN_RLS_ON_START=false docker compose up -d
docker compose exec web pnpm --dir /app/apps/web exec prisma migrate deploy
```

Un seul service applique les migrations. Le worker les ignore explicitement.

**Sur une base vierge**, la séquence complète est : création des rôles et bases
(`docker-init-db.sh`), `prisma migrate deploy`, puis `infra/sql/rls.sql`. Cette
séquence est vérifiée en CI par le job `docker-smoke`, qui démarre l'image réelle
sur un PostgreSQL vide, attend la sonde `/api/health` et compte les tables
créées.

---

## 5. Sauvegardes et restauration

Aucun script de sauvegarde automatique n'est fourni : la politique de sauvegarde
dépend de l'hébergeur et de la fréquence souhaitée. La procédure ci-dessous est
la référence à automatiser (cron, sauvegarde managée, etc.).

### Sauvegarde

```bash
# Sauvegarde logique complète, compressée
docker compose exec -T postgres \
  pg_dump -U postgres -d belloacademy --format=custom --no-owner \
  > "backup-belloacademy-$(date +%Y%m%d-%H%M).dump"

# Fichiers téléversés (stockage local uniquement)
docker run --rm -v belloacademy_minio-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/minio-$(date +%Y%m%d-%H%M).tar.gz -C /data .
```

Avec un stockage S3 externe, la sauvegarde des fichiers relève de l'hébergeur
(versioning de bucket, réplication).

Fréquence recommandée : sauvegarde quotidienne, rétention 30 jours, plus une
sauvegarde avant chaque migration.

### Restauration

```bash
# 1. Arrêter l'application (le worker en premier : il ne doit pas écrire)
docker compose stop web worker

# 2. Restaurer la base
docker compose exec -T postgres \
  pg_restore -U postgres -d belloacademy --clean --if-exists --no-owner \
  < backup-belloacademy-20260101-0300.dump

# 3. Rejouer les politiques RLS si la base a été restaurée hors Prisma
docker compose run --rm web pnpm --dir /app/apps/web run db:rls

# 4. Redémarrer
docker compose start web worker
curl -s https://academy.example.tn/api/health | jq .status
```

Testez la restauration au moins une fois sur un environnement séparé : une
sauvegarde jamais restaurée n'est pas une sauvegarde.

---

## 6. Supervision

### Sonde de disponibilité

`GET /api/health` vérifie la base de données, le stockage, Jitsi et la file de
tâches. Elle renvoie `503` dès qu'un composant est en défaut — utilisez-la comme
sonde de supervision externe (Uptime Kuma, BetterStack, Cloudflare Health
Checks) et comme sonde de conteneur (elle est déjà déclarée dans
`docker-compose.yml`).

### Journaux

Les conteneurs écrivent sur `stdout` en JSON structuré (`LOG_LEVEL` :
`debug`, `info`, `warn`, `error`). Récupérez-les avec `docker compose logs -f
web worker`, ou branchez le pilote de journalisation Docker sur votre
agrégateur (Loki, Grafana, Datadog).

Les journaux ne contiennent **jamais** de mots de passe, de jetons de session,
de secrets de paiement ni de contenu de fichiers. Les événements sensibles
(connexion, changement de rôle, opération de facturation) sont écrits dans la
table `audit_logs`, consultable depuis l'interface d'administration.

### Points de vigilance

| Signal | Cause probable | Action |
| --- | --- | --- |
| `checks.jobs.dead > 0` | Tâche échouée définitivement | Consulter `docker compose logs worker` |
| `checks.jitsi.ok = false` | `JITSI_DOMAIN` injoignable | Vérifier le DNS et `external_api.js` |
| `checks.storage.ok = false` | Identifiants S3 ou bucket manquant | Vérifier `S3_*` et `minio-init` |
| `checks.database.ok = false` | PostgreSQL arrêté ou pool épuisé | Vérifier `docker compose ps postgres` |

---

## 7. Mises à jour et retour arrière

```bash
# 1. Sauvegarder
docker compose exec -T postgres pg_dump -U postgres -d belloacademy \
  --format=custom --no-owner > "pre-update-$(date +%Y%m%d-%H%M).dump"

# 2. Récupérer la nouvelle version
git pull --ff-only
pnpm install --frozen-lockfile

# 3. Reconstruire et redémarrer (les migrations s'appliquent au démarrage)
docker compose build web worker
docker compose up -d

# 4. Vérifier
curl -s https://academy.example.tn/api/health | jq .status
```

**Retour arrière** : les migrations Prisma ne sont pas réversibles
automatiquement. Revenez au commit précédent, reconstruisez l'image, puis
restaurez la sauvegarde prise à l'étape 1 si la nouvelle migration a modifié le
schéma de façon incompatible.

---

## 8. Sécurité opérationnelle

- **Aucun secret dans Git.** `.env` est ignoré ; `.env.example` ne contient que
  des placeholders. Vérifiez avec `git log -p -- .env` qu'aucun secret n'a jamais
  été committé.
- **Rotation des secrets** : changez `AUTH_SECRET` invalide toutes les sessions
  en cours (les utilisateurs devront se reconnecter). Changez les mots de passe
  PostgreSQL via `ALTER ROLE` puis mettez à jour `.env`.
- **Exposition des ports** : en production derrière Caddy, supprimez la
  publication du port 3000 (`WEB_PORT`) et de la console MinIO
  (`MINIO_CONSOLE_PORT`). Seuls 80 et 443 doivent être publics, plus 10000/udp
  pour Jitsi.
- **Rôle plateforme** : `belloacademy_platform` porte `BYPASSRLS`. Sa chaîne de
  connexion ne doit jamais être exposée à du code exécuté côté client.
- **Dépendances** : `pnpm audit --prod` avant chaque mise en production ;
  corrigez les vulnérabilités critiques.

### Conservation et suppression des données

Aucune purge automatique n'est implémentée dans cette version. Les durées de
conservation sont donc une décision d'exploitation, à appliquer manuellement ou
via une tâche planifiée :

- **Journaux d'audit** (`audit_logs`) : conservation recommandée 12 mois, puis
  suppression par lots.
- **Notifications lues** : purge possible au-delà de 90 jours.
- **Comptes supprimés** : la suppression d'un compte (`users`) est en cascade
  sur ses inscriptions, tentatives et sessions. Les certificats déjà émis
  restent vérifiables publiquement (l'identifiant unique ne contient aucune
  donnée personnelle), ce qui est le comportement attendu pour un diplôme.
- **Droit à l'effacement** : traiter la demande en supprimant le compte, puis en
  vérifiant que les fichiers téléversés associés sont supprimés du stockage.

Documentez la durée retenue dans votre registre de traitement avant d'ouvrir le
service au public.

---

## 9. Dépannage

**Le conteneur `web` redémarre en boucle.**
Consultez `docker compose logs web`. Cause la plus fréquente : une variable
obligatoire manquante (`AUTH_SECRET`, `S3_*`) ou PostgreSQL injoignable. Le
point d'entrée attend la base 90 secondes (`DB_WAIT_TIMEOUT_SECONDS`) avant
d'abandonner.

**`prisma migrate deploy` échoue avec « P3005 : database schema is not empty ».**
La base contient des tables mais pas l'historique de migrations. Sur une base
jetable, réinitialisez (`docker compose down -v`) ; sinon, marquez les migrations
déjà appliquées avec `prisma migrate resolve --applied <migration>`.

**Les apprenants ne voient pas leurs formations.**
Vérifiez que le contexte de tenant est bien posé : sans `app.current_org_id`,
les politiques RLS ne renvoient aucune ligne (comportement voulu). Une requête
applicative hors `withTenant()` sur une table protégée échoue silencieusement
avec 0 ligne.

**Les e-mails ne partent pas.**
`MAIL_DRIVER=console` écrit dans `MAIL_SPOOL_DIR` (volume `app-var`) au lieu
d'envoyer. Pour un envoi réel, configurez `MAIL_DRIVER=smtp` et `SMTP_URL`.

**HTTPS échoue / boucle de redirection.**
`jitsi-web` doit rester en HTTP derrière Caddy (`DISABLE_HTTPS=1`,
`ENABLE_HTTP_REDIRECT=0`) : Caddy retransmet en HTTP, une redirection interne
créerait une boucle infinie.

---

## 10. Liste de contrôle avant ouverture au public

- [ ] `AUTH_SECRET` et tous les mots de passe générés aléatoirement, uniques
- [ ] `APP_URL` en `https://`, DNS propagé, certificat TLS obtenu
- [ ] Seed de démonstration **non** exécuté (ou comptes de démo supprimés)
- [ ] Port 3000 et console MinIO non exposés publiquement
- [ ] Sauvegarde automatique configurée **et** restauration testée
- [ ] Sonde `/api/health` branchée sur la supervision externe
- [ ] `pnpm audit --prod` sans vulnérabilité critique
- [ ] `RATE_LIMIT_ENABLED=true`, `TRUST_PROXY=true`
- [ ] Politique de conservation des données documentée
- [ ] Jitsi : `JITSI_REQUIRE_JWT=true` et secrets générés (voir [`jitsi.md`](jitsi.md))

## 11. Activer l'intégration continue

Le pipeline est versionné dans `infra/ci/ci.yml` et non directement dans
`.github/workflows/`, car le jeton utilisé pour pousser le code ne dispose pas de
la portée `workflow` exigée par GitHub pour écrire dans ce répertoire. Le fichier
est donc prêt à l'emploi mais doit être activé une fois, manuellement.

Depuis un poste disposant de vos identifiants GitHub :

```bash
mkdir -p .github/workflows
git mv infra/ci/ci.yml .github/workflows/ci.yml
git commit -m "Activation de l'intégration continue"
git push
```

Si vous préférez le faire depuis l'interface GitHub : ouvrez `infra/ci/ci.yml`,
copiez son contenu dans un nouveau fichier `.github/workflows/ci.yml`, puis
validez le commit sur `main`. GitHub n'accepte un nouveau fichier de workflow que
via une interface authentifiée disposant de la portée `workflow`.

### Jobs exécutés

| Job | Ce qu'il vérifie |
| --- | --- |
| `quality` | `pnpm typecheck`, `pnpm lint`, puis les tests unitaires |
| `integration` | Tests d'intégration sur un service PostgreSQL réel, avec les rôles et politiques RLS (isolation multi-tenant incluse) |
| `build` | `pnpm build` sur le monorepo |
| `compose` | Validation de `docker-compose.yml` sur tous les profils (`docker compose config`) |
| `docker-smoke` | Démarrage de l'image réelle, migrations, puis sonde `/api/health` |

Le job `docker-smoke` construit l'image de production, démarre un PostgreSQL
jetable, applique les migrations et interroge la sonde de disponibilité. C'est la
vérification la plus proche de la production : si elle passe, l'image est
réellement démarrable.

### Secrets de CI

Aucun secret n'est nécessaire : les jobs génèrent leurs propres valeurs
éphémères (`AUTH_SECRET`, mots de passe) et le stockage bascule en pilote local.
N'ajoutez pas de secrets de production dans les variables du dépôt.
