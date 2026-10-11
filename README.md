# BelloAcademy

Plateforme SaaS **multi-tenant** de formation en ligne : catalogue de formations,
lecteur de cours, classes virtuelles Jitsi Meet, quiz et devoirs, certificats
vérifiables, abonnements et facturation.

Le dépôt contient une application **fonctionnelle**, pas une maquette : les
parcours décrits plus bas sont exécutés par des tests automatisés réels (voir
[Tests](#tests-et-vérifications)).

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Stack technique](#stack-technique)
- [Démarrage rapide](#démarrage-rapide)
- [Comptes de démonstration](#comptes-de-démonstration)
- [Scripts disponibles](#scripts-disponibles)
- [Architecture](#architecture)
- [Isolation multi-tenant](#isolation-multi-tenant)
- [Classes virtuelles Jitsi Meet](#classes-virtuelles-jitsi-meet)
- [Facturation](#facturation)
- [Tests et vérifications](#tests-et-vérifications)
- [Docker et déploiement](#docker-et-déploiement)
- [Documentation détaillée](#documentation-détaillée)
- [Limites connues](#limites-connues)

---

## Fonctionnalités

### Authentification et comptes

Inscription, connexion, déconnexion, vérification d'adresse e-mail,
réinitialisation de mot de passe, sessions opaques en base (révocables),
protection CSRF, limitation du débit des routes sensibles.

Cinq rôles : `SUPER_ADMIN` (global), puis `ORG_ADMIN`, `INSTRUCTOR`,
`LEARNER` et `BILLING_MANAGER` au sein d'une organisation, avec les permissions
granulaires associées (`packages/shared/src/domain/identity.ts`).

### Organisations (multi-tenant)

Création et configuration d'organisations, paramètres par organisation
(inscription libre, vérification e-mail obligatoire, langue par défaut),
isolation stricte des données, journal d'audit des opérations sensibles,
quotas par forfait.

### Formations

Catalogue public avec recherche et filtres, fiches formation, sections,
leçons (vidéo, document, texte, lien, fichier, session live), ressources
téléchargeables, progression individuelle reprise là où l'apprenant s'est
arrêté, statuts brouillon / publié / archivé.

### Classes virtuelles

Sessions Jitsi Meet planifiées et rattachées à une formation : dates, durées,
fuseaux horaires, noms de salle imprévisibles, rôles hôte / modérateur /
participant, états programmée / en cours / terminée / annulée, présences,
rappels automatiques avant le cours, calendrier dans le tableau de bord.

### Évaluations

Quiz (choix unique, choix multiple, vrai/faux, réponse courte), barème et seuil
de réussite, durée limitée, nombre de tentatives configurable, correction
automatique, historique des résultats, corrections manuelles pour les réponses
libres, devoirs avec dépôt de fichiers et correction par le formateur.

### Certificats

Génération PDF après validation des conditions de réussite, identifiant unique,
page publique de vérification (`/verifier-certificat/<code>`) qui n'expose que
les informations strictement nécessaires.

### Abonnements et facturation

Forfaits configurables (limites et fonctionnalités), essais gratuits,
abonnements mensuels et annuels, historique des factures, renouvellements,
changements de forfait, webhooks signés et traités de manière idempotente.

### Notifications

Notifications in-app, e-mails de bienvenue, vérification d'adresse,
réinitialisation de mot de passe, confirmation d'inscription, rappels de
classes virtuelles, résultats d'évaluation, échéances de facturation.

### Tableaux de bord

Quatre tableaux de bord calculés à partir des données réelles de la base :
superadministration (organisations, utilisateurs, abonnements, statistiques
globales), administration d'organisation (utilisateurs, formations,
inscriptions, consommation), formateur (formations, progression, évaluations à
corriger, prochaines classes), apprenant (formations en cours, progression,
prochaines sessions, résultats, certificats).

---

## Stack technique

| Domaine | Choix | Version |
| --- | --- | --- |
| Frontend | Next.js (App Router), React, TypeScript | 16.4 / 19.3 / 5.9 |
| Styles | Tailwind CSS | 4.3 |
| Base de données | PostgreSQL | 17 |
| ORM | Prisma | 7.10 |
| Validation | Zod | 4.6 |
| Cache / file d'attente | Valkey (compatible Redis) — facultatif | 8 |
| Stockage de fichiers | Disque local ou tout stockage compatible S3 (MinIO) | — |
| Visioconférence | Jitsi Meet (IFrame API, instance publique ou auto-hébergée) | — |
| Tests | Vitest | 5.0 |
| Conteneurs | Docker + Docker Compose | — |
| Reverse proxy / TLS | Caddy | 2 |
| CI | GitHub Actions | — |
| Gestionnaire de paquets | pnpm (workspaces) | 10.29 |

### Justification des choix principaux

**Monolithe modulaire plutôt que microservices.** Une seule application Next.js
sert le rendu, les routes API et les tâches planifiées ; un processus `worker`
séparé consomme la file de tâches. À cette échelle, un découpage en services
indépendants multiplierait les points de défaillance et les coûts
d'exploitation sans bénéfice réel. Les frontières sont déjà tracées
(`src/server/services/*`), ce qui permet d'extraire un service plus tard.

**File de tâches en base plutôt que courtier externe.** La table `jobs` est
durable (un redémarrage ne perd rien) et le verrouillage
`FOR UPDATE SKIP LOCKED` autorise plusieurs workers concurrents sans double
exécution. Redis/Valkey reste utilisé pour le cache et la limitation de débit,
mais n'est pas un prérequis : sans `REDIS_URL`, un cache mémoire prend le relais.

**Trois rôles PostgreSQL distincts.** Voir
[Isolation multi-tenant](#isolation-multi-tenant) : c'est ce qui rend les
politiques RLS réellement contraignantes plutôt que décoratives.

**Sessions opaques en base plutôt que JWT.** Une déconnexion ou un changement de
rôle est immédiatement effectif, sans attendre l'expiration d'un jeton.

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 20.11 (testé sur 22)
- pnpm 10 (`corepack enable`)
- PostgreSQL 17 accessible en local

### Installation

```bash
# 1. Dépendances
pnpm install

# 2. Rôles et bases PostgreSQL (idempotent)
bash infra/scripts/dev-db.sh

# 3. Fichier d'environnement (génère AUTH_SECRET)
bash scripts/setup-env.sh

# 4. Schéma, politiques RLS et données de démonstration
pnpm db:migrate
pnpm db:rls
pnpm db:seed
```

`pnpm db:rls` n'est nécessaire que si la base a été créée sans migrations
(restauration d'un dump). La migration `row_level_security` applique déjà les
politiques ; la commande rejoue le même SQL de façon idempotente et vérifie le
résultat.

### Lancement

```bash
pnpm dev        # serveur de développement → http://localhost:3000
pnpm worker     # worker de tâches (2ᵉ terminal : e-mails, rappels, échéances)
```

Sans `pnpm worker`, les e-mails et les rappels de classes virtuelles restent en
file d'attente. Le reste de l'application fonctionne normalement.

### Vérification

```bash
curl -s http://localhost:3000/api/health
```

La sonde renvoie `{"status":"ok", ...}` avec l'état de la base, des tâches et du
stockage. Elle renvoie `503` si un composant critique est indisponible.

---

## Comptes de démonstration

Créés par `pnpm db:seed`. Mot de passe commun : **`BelloAcademy!2026`**
(ou la valeur de `SEED_PASSWORD`).

| Rôle | Adresse e-mail | Organisation |
| --- | --- | --- |
| Superadministrateur | `superadmin@belloacademy.tn` | — (plateforme) |
| Administrateur d'organisation | `direction@belloacademy.tn` | Académie Bello |
| Formateur | `formateur@belloacademy.tn` | Académie Bello |
| Apprenant | `apprenant@belloacademy.tn` | Académie Bello |
| Apprenante | `apprenante2@belloacademy.tn` | Académie Bello |
| Gestionnaire de facturation | `facturation@belloacademy.tn` | Académie Bello |

Le seed crée également l'organisation `academie-bello` (Tunisie, `Africa/Tunis`,
`TND`), les quatre forfaits (`free`, `starter`, `business`, `enterprise`), des
catégories, des formations publiées et brouillon,
des inscriptions, une session live planifiée, un quiz et un devoir.

> Ces comptes sont destinés au développement local : leurs identifiants sont
> publics. En `NODE_ENV=production`, `pnpm db:seed` refuse donc de les créer.
> Pour amorcer une instance de production, renseignez `SEED_SUPER_ADMIN_EMAIL`
> et `SEED_SUPER_ADMIN_PASSWORD` : le seed crée alors **uniquement** ce
> superadministrateur, sans aucune donnée de démonstration. `SEED_ALLOW_DEMO_DATA=true`
> force les données de démonstration (à réserver aux environnements jetables).

---

## Scripts disponibles

### Racine du dépôt

| Commande | Effet |
| --- | --- |
| `pnpm dev` | Serveur de développement |
| `pnpm build` | Build de production |
| `pnpm start` | Serveur de production |
| `pnpm worker` | Worker de tâches asynchrones |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Vérification des types (tous les paquets) |
| `pnpm test` | Tests unitaires (paquets partagé + web) |
| `pnpm test:unit` | Tests unitaires détaillés |
| `pnpm test:integration` | Tests d'intégration (base PostgreSQL dédiée) |
| `pnpm test:e2e` | Parcours critiques en HTTP réel |
| `pnpm test:all` | `typecheck` + `lint` + `test` + `test:integration` |
| `pnpm dev:db` | Provisionne les rôles et bases PostgreSQL |
| `pnpm db:migrate` | Applique les migrations (développement) |
| `pnpm db:deploy` | Applique les migrations (production) |
| `pnpm db:rls` | Réapplique et vérifie les politiques RLS |
| `pnpm db:seed` | Données de démonstration |
| `pnpm db:reset` | Réinitialise la base et rejoue le seed |
| `pnpm db:generate` | Régénère le client Prisma |

### Utilitaires ponctuels

```bash
# Purge les organisations et comptes de test laissés par une exécution e2e interrompue
pnpm --filter @belloacademy/web exec tsx scripts/e2e-critical-paths.ts --purge
```

---

## Architecture

```
belloacademy/
├── apps/
│   └── web/                          Application Next.js (UI + API + worker)
│       ├── prisma/
│       │   ├── schema.prisma         34 modèles, 19 énumérations
│       │   ├── migrations/           6 migrations
│       │   └── seed.ts               Données de démonstration
│       ├── scripts/
│       │   ├── worker.ts             Worker de file d'attente
│       │   ├── apply-rls.ts          Application des politiques RLS
│       │   ├── e2e-critical-paths.ts Parcours critiques HTTP
│       │   └── docker-entrypoint.sh  Attente DB, migrations, démarrage
│       ├── src/
│       │   ├── app/                  31 pages, 21 groupes de routes API
│       │   ├── components/           UI, formulaires, tableaux de bord, Jitsi
│       │   ├── lib/                  auth, db, jobs, storage, mail, jitsi, http
│       │   └── server/
│       │       ├── services/         13 services métier
│       │       └── jobs/handlers.ts  Gestionnaires de tâches
│       └── tests/                    unit/ et integration/
├── packages/
│   └── shared/                       Domaine pur, validation, utilitaires
│       └── src/
│           ├── domain/               Règles métier sans dépendance
│           ├── validation/           Schémas Zod partagés
│           ├── storage/              Signature S3 (SigV4), validation d'upload
│           └── utils/                Formatage, slugs, redirections sûres
├── infra/
│   ├── sql/                          init-db.sql, rls.sql, privilèges
│   ├── scripts/                      dev-db.sh, docker-init-db.sh
│   ├── Caddyfile                     Reverse proxy + TLS
│   └── Caddyfile.jitsi               Variante avec Jitsi auto-hébergé
├── docker-compose.yml                Pile complète (profils proxy et jitsi)
├── .github/workflows/ci.yml          Intégration continue
└── docs/                             Documentation technique
```

### Répartition des responsabilités

**`packages/shared`** ne dépend ni de Next.js ni de la base : uniquement des
fonctions pures (correction des quiz, calcul de progression, vérification des
limites de forfait, décision d'accès à une classe virtuelle, validation des
fichiers). C'est ce qui rend ces règles testables unitairement et réutilisables
côté serveur comme côté client.

**`src/server/services`** contient la logique métier et toutes les écritures en
base. Les routes API ne font que valider l'entrée, vérifier les autorisations et
appeler un service — aucune règle métier ne vit dans un gestionnaire de route.

**`src/lib`** fournit les briques transverses : sessions, CSRF, limitation de
débit, journal d'audit, stockage, e-mail, signature Jitsi.

---

## Isolation multi-tenant

Trois rôles PostgreSQL aux responsabilités disjointes :

| Rôle | Usage | RLS |
| --- | --- | --- |
| `belloacademy_owner` | Migrations, DDL, seed | `BYPASSRLS` |
| `belloacademy_app` | Runtime applicatif (`DATABASE_URL`) | **Soumis aux politiques** |
| `belloacademy_platform` | Superadministration, facturation inter-organisations | `BYPASSRLS` |

Le rôle applicatif **n'est pas propriétaire** des tables. C'est cette séparation
qui rend les politiques RLS contraignantes : un propriétaire de table les
contournerait par défaut.

24 tables portent une politique d'isolation (`infra/sql/rls.sql`) : appartenances,
catégories, formations, sections, leçons, ressources, fichiers, inscriptions,
progression, quiz, questions, réponses, tentatives, devoirs, rendus, certificats,
sessions live, présences, abonnements, factures, compteurs d'usage.

Le contexte tenant est posé par transaction via `set_config('app.organization_id', …)`
(`src/lib/db/prisma.ts`), de sorte qu'une requête ne peut pas lire les données
d'une autre organisation même si un identifiant est forgé dans l'URL ou le corps
de la requête.

Trois niveaux de défense se superposent :

1. **Contrôle d'accès applicatif** — `src/lib/auth/authorization.ts` vérifie le
   rôle et la permission avant tout appel de service.
2. **Filtrage par organisation** — chaque requête métier est explicitement
   restreinte à l'organisation active.
3. **Politiques RLS** — filet de sécurité au niveau du moteur, actif même si le
   code applicatif oubliait un filtre.

Les tests `tests/integration/rls-isolation.test.ts` vérifient qu'un tenant ne
peut jamais lire ni modifier les données d'un autre, y compris en forçant les
identifiants.

---

## Classes virtuelles Jitsi Meet

L'intégration repose sur l'**IFrame API** officielle
(`https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/`) et
fonctionne avec l'instance publique `meet.jit.si` comme avec une instance
auto-hébergée.

- Nom de salle construit par `buildJitsiRoomName()` : partie lisible dérivée de
  la formation + jeton aléatoire, conforme à un format validé côté serveur.
- **Le nom de salle n'est jamais un contrôle d'accès.** La décision est prise
  côté serveur par `decideLiveAccess()` (même organisation, statut de la session,
  formateur / personnel / inscrit), puis un jeton JWT signé est émis si
  l'instance l'exige.
- Rôles : `HOST` (formateur), `MODERATOR` (personnel), `PARTICIPANT` (inscrit).
- Rappels automatiques avant le cours via la file de tâches (`live.reminder`).

Configuration minimale (instance publique, salle ouverte côté Jitsi) :

```env
JITSI_DOMAIN="meet.jit.si"
JITSI_REQUIRE_JWT="false"
```

Configuration recommandée en production (jetons obligatoires) :

```env
JITSI_DOMAIN="meet.example.tn"
JITSI_APP_ID="belloacademy"
JITSI_APP_SECRET="<secret généré>"
JITSI_REQUIRE_JWT="true"
```

Guide complet — déploiement auto-hébergé, DNS, HTTPS, ports, pare-feu,
dépannage : [`docs/jitsi.md`](docs/jitsi.md).

---

## Facturation

Deux prestataires, sélectionnés par `BILLING_PROVIDER` :

- **`mock`** (défaut) — mode test **explicitement identifié**. Aucun paiement
  réel n'est effectué et aucun n'est présenté comme confirmé. Les abonnements et
  factures sont créés en base pour permettre le développement des parcours.
- **`stripe`** — prestataire réel. Nécessite `STRIPE_SECRET_KEY` et
  `STRIPE_WEBHOOK_SECRET`.

La logique métier (forfaits, limites, échéances, factures) est **indépendante**
du prestataire : `src/server/services/billing.ts` expose une interface
`PaymentProvider` et l'adaptateur Stripe s'y conforme. Ajouter un prestataire
consiste à écrire un adaptateur, sans toucher au reste.

Les webhooks sont vérifiés par signature (`verifyStripeSignature`), dédupliqués
par identifiant d'événement et appliqués de manière idempotente : un rejeu ne
produit jamais de double facturation. Voir `docs/deployment.md`.

---

## Tests et vérifications

| Suite | Commande | Volume | Portée |
| --- | --- | --- | --- |
| Unitaires (paquet partagé) | `pnpm --filter @belloacademy/shared test` | 92 tests | Domaine pur : correction, progression, limites, RLS, stockage |
| Unitaires (application) | `pnpm --filter @belloacademy/web test:unit` | 42 tests | Domaine, validation, utilitaires |
| Intégration | `pnpm test:integration` | 59 tests, 7 fichiers | Parcours réels sur PostgreSQL |
| Bout en bout | `pnpm test:e2e` | 14 vérifications | HTTP réel : sessions, CSRF, statuts, isolation |
| Types | `pnpm typecheck` | 2 paquets | Aucune erreur |
| Lint | `pnpm lint` | — | Aucune erreur |

### Couverture des critères d'acceptation

| Critère | Test |
| --- | --- |
| Création de compte et connexion | `auth-flow.test.ts`, e2e |
| Rôles et permissions appliqués | `auth-flow.test.ts`, e2e |
| Création d'organisation par un administrateur | `rls-isolation.test.ts` |
| Formation créée et publiée par un formateur | `enrollment-progress.test.ts` |
| Inscription et suivi d'une formation autorisée | `enrollment-progress.test.ts` |
| Progression enregistrée et restaurée | `enrollment-progress.test.ts` |
| Session Jitsi planifiée et rejointe selon les droits | `live-session.test.ts` |
| Quiz : résultats enregistrés et calculés | `assessment-certificate.test.ts` |
| Certificats générés et vérifiables | `assessment-certificate.test.ts`, e2e |
| Restrictions de forfait appliquées | `billing-plan-limits.test.ts` |
| Webhooks authentifiés et idempotents | `billing-plan-limits.test.ts` |
| Isolation stricte entre deux organisations | `rls-isolation.test.ts`, e2e |
| Fichiers privés inaccessibles sans autorisation | `uploads-permissions.test.ts` |
| Migrations sur base vierge | `tests/integration/setup.ts` (rejoué à chaque exécution) |
| Démarrage selon le README | `docker-smoke` (CI) |
| Build de production sans erreur | `pnpm build` |

Les tests d'intégration basculent automatiquement vers la base
`TEST_DATABASE_URL` : ils n'écrivent jamais dans la base de développement.

---

## Docker et déploiement

```bash
# Pile applicative seule (http://localhost:3000)
docker compose up -d

# Avec reverse proxy Caddy et HTTPS automatique
docker compose --profile proxy up -d

# Avec classes virtuelles Jitsi Meet auto-hébergées
CADDYFILE=Caddyfile.jitsi docker compose --profile proxy --profile jitsi up -d
```

Services : `postgres`, `redis` (Valkey), `minio`, `minio-init`, `web`, `worker`,
puis `caddy` (profil `proxy`) et `jitsi-web` / `prosody` / `jicofo` / `jvb`
(profil `jitsi`).

Variables obligatoires avant tout démarrage :

```bash
AUTH_SECRET="$(openssl rand -base64 48)"
POSTGRES_SUPERUSER_PASSWORD="$(openssl rand -base64 24)"
S3_ACCESS_KEY_ID="$(openssl rand -hex 12)"
S3_SECRET_ACCESS_KEY="$(openssl rand -base64 32)"
```

Le conteneur `web` attend la disponibilité de PostgreSQL, applique
`prisma migrate deploy` puis les politiques RLS avant de démarrer. Procédure
complète, sauvegardes, restauration et supervision :
[`docs/deployment.md`](docs/deployment.md).

---

## Documentation détaillée

| Document | Contenu |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Structure, flux de données, modèle de données, sécurité |
| [`docs/jitsi.md`](docs/jitsi.md) | Déploiement Jitsi, DNS, HTTPS, ports, dépannage |
| [`docs/deployment.md`](docs/deployment.md) | Production, variables, sauvegardes, supervision |

---

## Limites connues

- **Pas d'inscription en libre-service sur une organisation existante.** Un
  nouveau compte crée sa propre organisation. L'ajout à une organisation
  existante passe par une invitation (rôle `ORG_ADMIN` requis).
- **Le mode `mock` ne réalise aucun paiement.** Il sert au développement des
  parcours d'abonnement, pas à encaisser.
- **Jitsi auto-hébergé non testé de bout en bout dans cet environnement.** La
  configuration Compose et le guide sont fournis, mais l'enregistrement réel
  d'un participant n'a pas pu être vérifié ici (pas de démon Docker, pas de
  domaine public). Voir `docs/jitsi.md` pour la liste de contrôle.
- **Pas de traduction anglaise.** L'interface est en français ; la structure
  i18n est en place (`src/lib/i18n`), l'ajout d'une locale est prévu mais non
  livré.
- **Le worker doit tourner séparément.** `pnpm dev` ne démarre pas le worker ;
  sans lui, les e-mails et rappels restent en file.
- **L'image Docker embarque l'arborescence complète du monorepo** plutôt que la
  sortie `standalone` de Next, afin que `pnpm worker`, `pnpm db:rls` et
  `prisma migrate deploy` restent utilisables dans le conteneur. Compromis
  assumé : image plus volumineuse. Détails dans `docs/deployment.md`.
