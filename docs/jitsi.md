# Jitsi Meet — déploiement et exploitation

BelloAcademy utilise Jitsi Meet comme composant central des classes virtuelles.
L'intégration supporte deux modes, sans changement de code :

| Mode | `JITSI_REQUIRE_JWT` | Contrôle d'accès |
| --- | --- | --- |
| Instance publique (`meet.jit.si`) | `false` | Entièrement assuré par BelloAcademy en amont |
| Instance auto-hébergée avec jetons | `true` | BelloAcademy signe un JWT de courte durée portant salle et rôle |

Dans les deux modes, **le nom de salle n'est jamais une protection**. Le nom est
non devinable (24 caractères aléatoires), mais la décision d'accès est prise
côté serveur par `decideLiveAccess` (`apps/web/src/server/services/live.ts`)
*avant* toute génération de jeton ou d'URL de réunion. Un utilisateur qui
connaîtrait le nom de la salle ne peut donc pas la rejoindre sans autorisation.

---

## 1. Qui peut rejoindre une réunion

Quatre conditions, toutes vérifiées côté serveur à chaque demande de jonction :

1. **Membre actif de l'organisation** — l'utilisateur doit appartenir à
   l'organisation propriétaire de la session (contrainte RLS + contrôle
   explicite).
2. **Inscription à la formation** — un apprenant doit être inscrit à la
   formation à laquelle la session est rattachée. Les administrateurs
   d'organisation et le formateur titulaire en sont dispensés.
3. **Fenêtre horaire** — la salle n'ouvre que `JOIN_WINDOW_BEFORE_MINUTES`
   (15 min) avant le début et se referme `JOIN_WINDOW_AFTER_MINUTES` (60 min)
   après la fin. Hors fenêtre, la jonction est refusée.
4. **Statut de la session** — seules les sessions `SCHEDULED` et `LIVE` sont
   joignables. Une session `ENDED` ou `CANCELLED` ne l'est plus.

Le rôle dans la réunion en découle :

| Rôle BelloAcademy | Rôle Jitsi | Peut modérer |
| --- | --- | --- |
| Formateur titulaire, co-animateur, administrateur d'organisation | `moderator` | Oui (enregistrement, diffusion, expulsion) |
| Apprenant inscrit | `participant` | Non |

Cycle de vie d'une session : `SCHEDULED` → `LIVE` → `ENDED`, ou
`CANCELLED` depuis `SCHEDULED`/`LIVE`. Le passage `SCHEDULED` → `LIVE` est
automatique, assuré par la tâche récurrente `live.status_sync` (toutes les
5 minutes). Les rappels sont envoyés par la tâche `live.reminder`.

---

## 2. Mode 1 — Instance publique `meet.jit.si`

Configuration minimale, adaptée au développement et aux petits déploiements.

```bash
JITSI_DOMAIN="meet.jit.si"
JITSI_REQUIRE_JWT="false"
JITSI_ROOM_PREFIX="belloacademy"
```

Aucun conteneur Jitsi n'est nécessaire : `docker compose up -d` suffit.
L'URL de jonction est construite côté serveur sous la forme
`https://meet.jit.si/<nom-de-salle>?userInfo.displayName=...` et n'est
transmise qu'après décision d'accès positive.

**Limites à connaître** : sur une instance publique, le premier arrivé devient
souvent modérateur, et l'instance ne peut pas distinguer un formateur d'un
apprenant. Si la modération fiable des salles est importante pour votre usage,
utilisez le mode 2.

---

## 3. Mode 2 — Instance auto-hébergée avec authentification par jeton

C'est le mode recommandé en production : BelloAcademy est la seule autorité qui
décide qui entre, et avec quel rôle.

### 3.1 Prérequis

- Deux noms de domaine distincts pointant vers le serveur :
  - `academy.example.tn` → `SITE_DOMAIN` (plateforme) ;
  - `meet.example.tn` → `JITSI_SITE_ADDRESS` (Jitsi).
  Ces deux noms **doivent être différents** : les cookies et l'origine ne
  peuvent pas être partagés entre la plateforme et l'instance de réunion.
- Un enregistrement `A` (ou `AAAA`) pour chacun.
- Ports ouverts côté pare-feu :

| Port | Protocole | Usage | Obligatoire |
| --- | --- | --- | --- |
| 80 | TCP | Redirection HTTP → HTTPS (Caddy) | Oui |
| 443 | TCP | HTTPS, interface Jitsi, signalisation WebSocket | Oui |
| 10000 | **UDP** | Média WebRTC (audio/vidéo) | Oui |
| 10000 | TCP | Média WebRTC en repli pour les réseaux filtrants | Recommandé |

Sans le port `10000/udp`, les réunions s'ouvrent mais restent silencieuses et
noires : l'interface fonctionne, le média ne passe pas. C'est la cause d'échec
la plus fréquente.

### 3.2 Générer les secrets

Trois secrets indépendants sont nécessaires. Générez-les aléatoirement — ne
réutilisez jamais une valeur d'exemple.

```bash
JICOFO_AUTH_PASSWORD="$(openssl rand -hex 16)"
JVB_AUTH_PASSWORD="$(openssl rand -hex 16)"
JICOFO_COMPONENT_SECRET="$(openssl rand -hex 16)"
JITSI_APP_SECRET="$(openssl rand -hex 32)"
```

`JITSI_APP_SECRET` est partagé entre `prosody` et l'application : c'est lui qui
signe et vérifie les jetons. `JICOFO_AUTH_PASSWORD` et `JVB_AUTH_PASSWORD`
restent internes à la pile Jitsi.

### 3.3 Renseigner l'environnement

Dans le fichier `.env` à la racine du dépôt :

```bash
# --- Plateforme ---
SITE_DOMAIN="academy.example.tn"
APP_URL="https://academy.example.tn"
CADDYFILE="Caddyfile.jitsi"
APP_UPSTREAM="web:3000"

# --- Jitsi ---
JITSI_SITE_ADDRESS="meet.example.tn"
JITSI_DOMAIN="meet.example.tn"
JITSI_REQUIRE_JWT="true"
JITSI_APP_ID="belloacademy"
JITSI_APP_SECRET="<secret généré en 3.2>"
JITSI_JWT_ISSUER="belloacademy"
JITSI_JWT_AUDIENCE="jitsi"

# --- Secrets internes Jitsi ---
JICOFO_AUTH_PASSWORD="<secret généré en 3.2>"
JVB_AUTH_PASSWORD="<secret généré en 3.2>"
JICOFO_COMPONENT_SECRET="<secret généré en 3.2>"

# --- Réseau média ---
# Adresse publique annoncée aux navigateurs par le pont vidéo (JVB).
# Obligatoire si le serveur est derrière NAT ; laissez vide si l'IP publique
# est directement portée par la machine.
JVB_ADVERTISE_IPS="203.0.113.10"
```

`JITSI_APP_ID` et `JITSI_APP_SECRET` doivent être **identiques** des deux côtés
(application et pile Jitsi) : la pile les reçoit via `jitsi-common`, défini dans
`docker-compose.yml`.

### 3.4 Démarrer la pile

```bash
CADDYFILE=Caddyfile.jitsi docker compose --profile proxy --profile jitsi up -d
```

Services démarrés :

| Service | Rôle | Exposition |
| --- | --- | --- |
| `jitsi-config-check` | Vérifie la présence des secrets, puis s'arrête | Interne |
| `jitsi-web` | Interface web et fichiers statiques | Interne (`jitsi-web:80`) |
| `prosody` | Signalisation XMPP, vérification des jetons | Interne (`prosody:5280`) |
| `jicofo` | Coordination des conférences | Interne |
| `jvb` | Pont vidéo (média WebRTC) | `10000/udp` et `10000/tcp` |
| `caddy` | Terminaison TLS, HTTPS automatique | `80`, `443` |

Le service `jitsi-config-check` refuse de démarrer la pile si
`JICOFO_COMPONENT_SECRET`, `JICOFO_AUTH_PASSWORD` ou `JITSI_APP_SECRET` sont
vides. C'est volontaire : un démarrage avec des secrets par défaut exposerait
les réunions. Le message d'erreur indique la variable manquante.

### 3.5 Points de configuration à comprendre

**Caddy termine le TLS, pas jitsi-web.** `jitsi-web` sert en HTTP et
`ENABLE_HTTP_REDIRECT=0`. Si vous activez la redirection HTTPS dans
`jitsi-web`, vous créez une boucle de redirection infinie : Caddy retransmet en
HTTP, jitsi-web redirige vers HTTPS, Caddy retransmet à nouveau en HTTP.
`DISABLE_HTTPS=1` et `ENABLE_LETSENCRYPT=0` sont positionnés pour la même
raison — c'est Caddy qui gère les certificats.

**Les WebSockets passent sans configuration.** Caddy gère nativement les
montées de connexion, donc `/xmpp-websocket` et `/http-bind` traversent le
proxy tels quels.

**Le jeton porte le rôle.** `signJitsiToken`
(`apps/web/src/lib/jitsi.ts`) émet un JWT HS256 de 2 heures avec
`context.user.moderator` positionné selon le rôle BelloAcademy, et
`context.features.recording` / `livestreaming` réservés aux modérateurs.
`JWT_ALLOW_EMPTY=0` garantit qu'aucune salle n'est accessible sans jeton.

**L'URL n'est jamais publique.** Elle n'est retournée qu'à l'utilisateur
autorisé, par la route `POST /api/live-sessions/:id/join`.

---

## 4. Vérification après déploiement

```bash
# 1. La sonde applicative doit voir Jitsi joignable
curl -s https://academy.example.tn/api/health | jq '.checks.jitsi'
# attendu : { "ok": true, "detail": "meet.example.tn" }

# 2. L'interface Jitsi doit répondre
curl -sI https://meet.example.tn/external_api.js | head -1
# attendu : HTTP/2 200

# 3. Le certificat doit être valide
curl -sI https://meet.example.tn | grep -i strict-transport
```

Puis, depuis l'application : se connecter en formateur, programmer une session,
et vérifier que la jonction fonctionne dans la fenêtre horaire (15 min avant le
début).

---

## 5. Dépannage

### La réunion s'ouvre mais il n'y a ni son ni image

Cause la plus fréquente : `10000/udp` est fermé, ou `JVB_ADVERTISE_IPS` est
absent/vide derrière un NAT.

```bash
# Vérifier que le pont vidéo écoute
docker compose --profile jitsi logs jvb | grep -i "advertise\|harvester"
```

Si le serveur est derrière NAT, renseignez `JVB_ADVERTISE_IPS` avec l'adresse
publique. Si `JVB_TCP_HARVESTER_DISABLED=false`, le repli TCP est actif, mais
les performances sont inférieures.

### « Authentication failed » ou renvoi immédiat vers l'écran d'accueil

Le jeton est refusé par `prosody`. Vérifiez dans cet ordre :

1. `JITSI_APP_SECRET` est identique dans l'application et dans la pile Jitsi.
2. `JITSI_APP_ID` correspond à `JWT_APP_ID` côté jitsi-web.
3. `JITSI_JWT_ISSUER` est bien dans `JWT_ACCEPTED_ISSUERS`, et
   `JITSI_JWT_AUDIENCE` dans `JWT_ACCEPTED_AUDIENCES`.
4. L'horloge du serveur est à l'heure : un décalage de plus de quelques minutes
   invalide le jeton. Le jeton est émis avec 30 secondes de marge (`nbf`), ce
   qui absorbe les petits dérivatifs, pas un décalage franc.

```bash
docker compose --profile jitsi logs prosody | grep -i jwt
```

### Boucle de redirection infinie sur le domaine Jitsi

`ENABLE_HTTP_REDIRECT` a été activé côté jitsi-web alors que Caddy termine déjà
le TLS. Remettez `ENABLE_HTTP_REDIRECT=0` et `DISABLE_HTTPS=1`.

### La pile refuse de démarrer

`jitsi-config-check` a détecté un secret manquant. Le message d'erreur nomme la
variable. Reportez-vous à la section 3.2.

### Vérifier que le média sort bien du serveur

```bash
# Le pont vidéo doit apparaître en écoute
ss -lunp | grep 10000
```

---

## 6. Journalisation et vie privée

Les événements de classe virtuelle sont journalisés dans `audit_logs` via
`recordAudit` : programmation, mise à jour, annulation, jonction et sortie. Les
entrées contiennent l'identifiant d'utilisateur, la session et l'horodatage.

Aucune donnée de contenu de réunion n'est collectée : pas de transcription, pas
d'enregistrement automatique, pas de piste d'audience individuelle au-delà de
l'événement de jonction. `context.user.email` n'est transmis dans le jeton que
s'il est disponible, et reste facultatif.

Les journaux de `prosody` et `jvb` sont techniques (signalisation, ICE) ; ils
sont conservés par la politique de rotation Docker et ne sont pas exportés vers
la plateforme.

---

## 7. Références

- Présentation générale : <https://jitsi.github.io/handbook/docs/intro/>
- Guide DevOps : <https://jitsi.github.io/handbook/docs/devops-guide/>
- API IFrame : <https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/>
- Authentification par jeton : <https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-token/>
