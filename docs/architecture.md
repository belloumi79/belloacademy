# Architecture — BelloAcademy

Document technique de référence : structure du dépôt, cheminement d'une requête,
isolation multi-tenant, modèle de données, tâches asynchrones et stockage de
fichiers. Les décisions et leurs justifications sont dans la section
« Décisions techniques » en fin de document.

---

## 1. Vue d'ensemble

Monolithe modulaire : **une seule application Next.js** porte l'interface, l'API
et le worker de tâches. Aucun microservice à exploiter, aucune communication
inter-processus à déboguer — mais des frontières internes strictes (domaine pur,
services, routes) pour pouvoir extraire un service plus tard sans réécrire la
logique métier.

```
Navigateur ──► Caddy (TLS, HTTP/2) ──► Next.js (apps/web)
                                          ├── pages React (Server Components)
                                          ├── routes API  (/api/*)
                                          └── services    (src/server/services)
                                                     │
                        ┌────────────────────────────┼───────────────────────┐
                        ▼                            ▼                       ▼
                  PostgreSQL 17                 Valkey 8            MinIO (S3)
              (données + RLS + file          (cache, limitation     (fichiers)
               de tâches `jobs`)              de débit)
```

Le worker (`apps/web/scripts/worker.ts`) est un **second processus, même image** :
il consomme la table `jobs` avec `FOR UPDATE SKIP LOCKED`, ce qui autorise
plusieurs réplicas sans double exécution.

---

## 2. Structure du dépôt

```
belloacademy/
├── apps/
│   └── web/                        Application Next.js (UI + API + worker)
│       ├── prisma/
│       │   ├── schema.prisma        34 modèles, 19 énumérations
│       │   ├── migrations/          6 migrations versionnées
│       │   └── seed.ts              données de démonstration (idempotent)
│       ├── public/                  ressources statiques
│       ├── scripts/
│       │   ├── worker.ts            worker de la file `jobs`
│       │   ├── apply-rls.ts         réapplication des politiques RLS
│       │   ├── e2e-critical-paths.ts parcours HTTP critiques (+ --purge)
│       │   └── docker-entrypoint.sh attente base + migrations + démarrage
│       ├── src/
│       │   ├── app/                 routes (pages + API)
│       │   ├── components/          composants React (ui, dashboard, live…)
│       │   ├── lib/                 infrastructure
│       │   │   ├── auth/            sessions, mots de passe, jetons, autorisation
│       │   │   ├── db/              clients Prisma (app et plateforme)
│       │   │   ├── http/            routeur, réponses, contexte tenant
│       │   │   ├── i18n/            dictionnaires fr (extensible)
│       │   │   └── …                csrf, audit, jobs, mail, jitsi, storage
│       │   └── server/
│       │       ├── jobs/            gestionnaires de tâches
│       │       └── services/        13 services métier
│       ├── tests/
│       │   ├── unit/                domaine, validation, utilitaires
│       │   └── integration/         parcours sur PostgreSQL réel
│       └── Dockerfile
├── packages/
│   └── shared/                     Domaine pur, partagé et testable sans base
│       ├── src/domain/              identité, cours, apprentissage, évaluation,
│       │                            classes virtuelles, facturation, organisation
│       ├── src/validation/          schémas Zod (source unique de vérité)
│       ├── src/storage/             validation de fichiers, clés S3, SigV4
│       ├── src/utils/               formatage, slugs, sécurité des redirections
│       └── tests/                   92 tests
├── infra/
│   ├── sql/                        init-db.sql, rls.sql, app-role-privileges.sql
│   ├── scripts/                    dev-db.sh, docker-init-db.sh
│   ├── Caddyfile                   reverse proxy applicatif
│   └── Caddyfile.jitsi             reverse proxy applicatif + Jitsi
├── docs/                           ce document, jitsi.md, deployment.md
├── scripts/setup-env.sh            génération de apps/web/.env
├── docker-compose.yml              pile complète (profils proxy, jitsi)
└── .github/workflows/ci.yml        5 travaux CI
```

---

## 3. Cheminement d'une requête

```
1. src/middleware.ts   (runtime Edge)
   ├── en-têtes de sécurité + Content-Security-Policy
   ├── cookie CSRF (belloacademy_csrf, non httpOnly)
   └── redirection vers /connexion si route privée sans cookie de session
       ↳ contrôle de présence uniquement : aucune décision d'autorisation ici

2. Route API (src/app/api/<domaine>/[...path]/route.ts)
   └── createDispatcher([...]) : table de routes (méthode + motif → handler)
       ├── résolution des paramètres dynamiques
       ├── lecture du corps JSON
       └── en-tête X-Organization-ID facultatif

3. Garde (src/lib/http/tenant.ts, src/lib/auth/authorization.ts)
   ├── session valide (cookie → SHA-256 → table sessions)
   ├── appartenance à l'organisation active (sinon 403)
   └── permission requise (ex. course:write, member:invite)

4. Service (src/server/services/<domaine>.ts)
   ├── validation Zod (schémas de packages/shared)
   ├── règles métier (domaine pur de packages/shared)
   ├── withTenant(organizationId, tx => …) : transaction + SET LOCAL
   │   app.current_organization_id → politiques RLS appliquées par PostgreSQL
   └── recordAudit(...) pour les opérations sensibles

5. Réponse (src/lib/http/api.ts)
   └── jsonOk / jsonCreated / jsonNoContent ; erreurs normalisées
```

**Aucune autorisation n'est décidée côté client.** Les Server Components
revérifient systématiquement la session et les droits avant de rendre une page
privée : masquer un bouton n'est jamais une protection.

---

## 4. Isolation multi-tenant

Stratégie retenue : **défense en profondeur**, trois couches indépendantes.

### Couche 1 — Autorisation applicative

`src/lib/auth/authorization.ts` résout la session, l'appartenance et la
permission demandée. Un utilisateur qui modifie un identifiant dans une URL ou
un corps de requête est arrêté ici.

### Couche 2 — Contraintes de base de données

Chaque table portant des données de tenant possède une colonne
`organizationId` non nulle et une clé étrangère vers `organizations`. Les
identifiants exposés sont des UUID, jamais des entiers séquentiels : un
identifiant valide d'un autre tenant n'est pas devinable.

### Couche 3 — Row Level Security PostgreSQL

Trois rôles distincts, chacun avec un périmètre précis :

| Rôle | Usage | `BYPASSRLS` | Propriétaire des objets |
| --- | --- | --- | --- |
| `belloacademy_owner` | migrations, seed, DDL | oui | oui |
| `belloacademy_app` | **runtime de l'application** | **non** | **non** |
| `belloacademy_platform` | superadministration, facturation inter-organisations | oui | non |

Le rôle applicatif n'étant **pas propriétaire** des tables, il n'échappe pas aux
politiques RLS (un propriétaire les contourne par défaut). C'est le point
essentiel : l'application ne peut pas lire les données d'un autre tenant même en
cas de faille dans la couche 1.

`infra/sql/rls.sql` couvre **24 tables** de tenant :

```
memberships, membership_invites, categories, courses, sections, lessons,
lesson_resources, assets, enrollments, lesson_progress, quizzes, questions,
question_options, quiz_attempts, quiz_answers, assignments,
assignment_submissions, submission_files, certificates, live_sessions,
live_attendance, subscriptions, invoices, usage_counters
```

Le contexte est posé par `withTenant()`, qui exécute dans une transaction :

```sql
SET LOCAL app.current_organization_id = '<uuid>';
```

`SET LOCAL` est limité à la transaction : aucune fuite de contexte entre deux
requêtes servies par la même connexion du pool.

La variable `app.current_organization_id` est lue via `current_setting(...,
true)` — la forme à deux arguments renvoie `NULL` au lieu d'échouer quand la
variable n'est pas définie. Une connexion hors contexte voit donc **zéro ligne**,
jamais toutes les lignes.

> Les politiques n'ont pas de clause `FORCE ROW LEVEL SECURITY` : le rôle
> `belloacademy_owner` conserve volontairement l'accès complet pour les
> migrations et le seed. C'est le rôle `app`, utilisé à l'exécution, qui est
> soumis aux politiques.

### Vérification

- `apps/web/tests/integration/rls-isolation.test.ts` : deux tenants, tentatives
  de lecture croisée, accès hors contexte, contrôles via les deux clients.
- `apps/web/scripts/e2e-critical-paths.ts` : tentative de lecture inter-tenant
  par HTTP avec `X-Organization-ID` forgé → 403/404.
- `prisma migrate reset` puis `prisma migrate deploy` sur une base vierge, avec
  vérification que les 24 tables sont bien protégées (`scripts/apply-rls.ts`).

---

## 5. Modèle de données

34 modèles, regroupés par domaine. Tous les identifiants sont des UUID.

| Domaine | Modèles |
| --- | --- |
| Identité | `User`, `Session`, `AuthToken`, `Membership`, `MembershipInvite` |
| Organisation | `Organization`, `AuditLog` |
| Catalogue | `Category`, `Course`, `Section`, `Lesson`, `LessonResource` |
| Apprentissage | `Enrollment`, `LessonProgress` |
| Évaluation | `Quiz`, `Question`, `QuestionOption`, `QuizAttempt`, `QuizAnswer` |
| Devoirs | `Assignment`, `AssignmentSubmission`, `SubmissionFile` |
| Certificats | `Certificate` |
| Classes virtuelles | `LiveSession`, `LiveAttendance` |
| Facturation | `Plan`, `Subscription`, `Invoice`, `PaymentEvent`, `UsageCounter` |
| Infrastructure | `Job`, `Asset`, `Notification` |

Points notables :

- **`QuizAttempt`** stocke `score` en pourcentage (0-100) et `maxScore = 100`,
  pour que le seuil de réussite (`passingScore`) ne dépende pas du nombre de
  questions. `rawScore` / `rawMaxScore` conservent les points bruts.
- **`Certificate`** possède un `serial` unique (préfixe `BA`) et une page
  publique de vérification qui n'expose que le nom du titulaire, le titre de la
  formation et la date — aucune donnée personnelle superflue.
- **`PaymentEvent`** conserve l'identifiant d'événement du prestataire avec une
  contrainte d'unicité : c'est ce qui rend le traitement des webhooks
  idempotent (un rejeu ne crédite pas deux fois).
- **`UsageCounter`** alimente l'application des limites de forfait par période.

---

## 6. Tâches asynchrones

File persistée en base plutôt qu'un courtier externe : durable (un redémarrage
ne perd rien), aucun service supplémentaire en développement, et
`FOR UPDATE SKIP LOCKED` suffit à paralléliser plusieurs workers.

Tâches enregistrées (`src/lib/jobs.ts`, `src/server/jobs/handlers.ts`) :

| Tâche | Rôle |
| --- | --- |
| `email.send` | envoi des e-mails mis en file |
| `live.reminder` | rappel avant une classe virtuelle |
| `live.status_sync` | bascule automatique `SCHEDULED` → `LIVE` → `ENDED` |
| `certificate.issue` | émission d'un certificat |
| `billing.subscription_renewal` | renouvellement des abonnements arrivés à échéance |
| `billing.trial_check` | fin de période d'essai |
| `plan.usage_snapshot` | instantané de consommation par organisation |

Comportement : reprise avec **backoff exponentiel** (30 s × 2^n, plafonné à 1 h),
puis statut `DEAD` après `maxAttempts` pour inspection. Les tâches bloquées par un
worker disparu sont libérées après 15 minutes (`releaseStaleJobs`).

`enqueue()` accepte une `dedupeKey` : deux tentatives de programmer le même
rappel n'en créent qu'un seul.

---

## 7. Stockage de fichiers

Deux pilotes derrière une interface unique (`src/lib/storage.ts`) :

- **`local`** — disque, pour le développement. Les fichiers ne sont jamais
  servis directement : ils passent par `/api/files/[assetId]`, qui applique les
  contrôles d'autorisation.
- **`s3`** — tout stockage compatible S3 (MinIO auto-hébergé, AWS, Scaleway…),
  avec URL présignées de courte durée (300 s).

Mesures appliquées quel que soit le pilote :

1. **Validation avant dépôt** — type MIME autorisé, extension cohérente avec le
   type déclaré, taille maximale par catégorie (200 Mo par défaut).
2. **Clé cloisonnée** — `org/<organizationId>/<catégorie>/<année>/<mois>/<uuid>-<nom>`.
   Le préfixe par organisation permet des politiques de bucket et des audits
   simples.
3. **Nom assaini** — accents supprimés, caractères non sûrs remplacés, longueur
   bornée ; sûr pour `Content-Disposition` et pour une clé S3.
4. **Dépôt direct** — le corps du fichier va directement du navigateur vers S3
   via une URL présignée `PUT` ; il ne traverse pas le serveur Next.js. Le
   ticket de dépôt est nominatif : la clé est calculée côté serveur, jamais
   fournie par le client.
5. **Anti-traversée** — le pilote local vérifie que le chemin résolu reste sous
   la racine de stockage.
6. **Ressources privées** — `resolveAssetAccess()` décide de l'accès à partir de
   la visibilité de l'actif, de l'appartenance et de l'inscription.

---

## 8. Sécurité

| Mesure | Mise en œuvre |
| --- | --- |
| Mots de passe | scrypt (N=2^15, r=8, p=1), sel de 16 octets, paramètres stockés dans l'empreinte pour permettre la migration |
| Sessions | jeton opaque de 32 octets, **seul le SHA-256 est stocké** ; cookie `httpOnly`, `sameSite=lax`, `secure` en production |
| CSRF | jeton en double soumission, en-tête `X-CSRF-Token` exigé sur les mutations |
| Limitation de débit | fenêtre glissante en mémoire ou Valkey (`src/lib/rate-limit.ts`) |
| CSP | définie dans `src/middleware.ts`, autorise `frame-ancestors` et `connect-src` vers le domaine Jitsi configuré uniquement |
| En-têtes | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Injection | Prisma en requêtes paramétrées ; le seul SQL brut (`jobs`, RLS) utilise des paramètres liés |
| Redirections | `safeRedirectPath()` refuse les URL absolues, les schémas `//`, les antislashs et les caractères de contrôle |
| Journalisation | `recordAudit()` conserve acteur, action, entité, IP et agent — **jamais** de mot de passe, jeton ni secret |
| Webhooks | signature HMAC vérifiée en comparaison à temps constant, horodatage contrôlé, idempotence par identifiant d'événement |
| Secrets | uniquement par variables d'environnement ; `.env` est ignoré par Git, `.env.example` ne contient aucune valeur réelle |

Le seed refuse de créer les comptes de démonstration en production : il exige
`SEED_SUPER_ADMIN_EMAIL` et `SEED_SUPER_ADMIN_PASSWORD` (validés par la politique
de mot de passe), ou une autorisation explicite via `SEED_ALLOW_DEMO_DATA=true`.

---

## 9. Internationalisation

- Locale par défaut : `fr` (`DEFAULT_LOCALE`). Dictionnaires dans
  `src/lib/i18n/dictionaries/`, accès typé via `src/lib/i18n/index.ts`.
- Fuseau par défaut : `Africa/Tunis` ; chaque organisation et chaque session de
  classe virtuelle peut avoir le sien.
- Montants en **TND** par défaut, formatés via `Intl.NumberFormat`.
- Ajouter une langue = ajouter un dictionnaire ; aucune chaîne n'est codée en
  dur dans les composants qui utilisent le module i18n.

---

## 10. Décisions techniques

| Décision | Justification |
| --- | --- |
| Monolithe modulaire plutôt que microservices | Une équipe réduite exploite plus simplement un seul déployable ; les frontières internes (domaine / services / routes) permettent une extraction ultérieure sans réécrire la logique métier. |
| Next.js App Router (UI + API) plutôt qu'un backend NestJS séparé | Évite un second service, une seconde configuration CORS et une duplication des types. Les routes API sont des handlers Web standard, donc portable. |
| Prisma plutôt que Drizzle | Migrations versionnées, `migrate deploy` adapté à la production, et surtout deux clients (`app` et `platform`) séparés — indispensable pour piloter deux rôles PostgreSQL distincts. |
| File en base plutôt que Redis/BullMQ | Durabilité sans service supplémentaire, et `FOR UPDATE SKIP LOCKED` offre la concurrence nécessaire à cette échelle. Redis reste utilisé pour le cache et la limitation de débit. |
| RLS PostgreSQL en plus de l'autorisation applicative | Le coût d'une erreur d'autorisation passe d'une fuite de données à un refus. La couche 3 protège même si la couche 1 est contournée. |
| Trois rôles PostgreSQL | Un rôle unique ne peut pas à la fois posséder les tables (migrations) et y être soumis (RLS). La séparation est ce qui rend RLS réellement contraignante. |
| Sessions opaques en base plutôt que JWT | Révocation immédiate (déconnexion, changement de rôle, bannissement), sans liste de révocation à maintenir. |
| Jitsi Meet en iframe + JWT côté serveur | Aucun développement d'application de visioconférence, instance publique ou auto-hébergée au choix, et le nom de salle n'est jamais une protection : la décision d'accès est prise côté serveur avant toute génération de jeton. |
| Paquet `shared` distribué en TypeScript | Pas d'étape de build intermédiaire ; Next le compile via `transpilePackages`. Une seule définition des schémas Zod et des règles métier. |
| `pnpm` workspaces | Installation stricte (pas de dépendances fantômes) et reproductible via `pnpm-lock.yaml`. |
