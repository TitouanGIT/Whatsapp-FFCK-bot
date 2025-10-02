
# WhatsApp FFCK Bot — Guide d’installation

Ce dépôt contient un bot WhatsApp destiné à faciliter la création et la gestion de groupes pour des compétitions (FFCK). Il s’appuie sur [whatsapp-web.js] pour piloter un compte WhatsApp Web depuis Node.js et sur MariaDB/MySQL pour stocker les compétitions.

---

## 1) Prérequis

### Option A — Exécution **sans Docker**
- **Node.js 20+** et **npm**
- **Chromium/Google Chrome** installés localement (nécessaires à WhatsApp Web)
- **MariaDB ou MySQL** accessibles (local ou distant)
- OS testé : Linux x64. Sous macOS/Windows, utilisez *Google Chrome* installé et vérifiez le chemin de l’exécutable si nécessaire.

### Option B — Exécution **avec Docker** (recommandée)
- **Docker** et **Docker Compose**
- Pas besoin d’installer Node.js/Chromium localement : l’image les contient.

---

## 2) Récupération du code

Décompressez l’archive dans un dossier, par ex. :

```bash
unzip Whatsapp_FFCK_Bot.zip -d ./
cd Whatsapp_FFCK_Bot
```

La structure principale :

```
.
├─ Dockerfile
├─ docker-compose.yml
├─ package.json
├─ .env                     # à remplir (voir §3)
└─ src/
   ├─ index.js
   ├─ commands.js
   ├─ db.js
   └─ utils.js
```

---

## 3) Configuration (fichier `.env`)

Copiez/éditez le fichier `.env` à la racine :

```dotenv
# Connexion DB
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=ffckbot

# Groupes WhatsApp fixes : ID/JID de vos salons existants
CREATOR_GROUP_ID=
VISITOR_GROUP_ID=

# Préfixe pour les groupes créés par le bot
GROUP_PREFIX=[Compétition]

# Chemin local d’authentification WhatsApp (persistant)
LOCAL_AUTH_DATA_PATH=/app/auth
```

- **CREATOR_GROUP_ID** : JID du groupe « création » où les admins pilotent le bot.
- **VISITOR_GROUP_ID** : JID d’un groupe « invités ».
- **LOCAL_AUTH_DATA_PATH** : dossier où seront stockées les sessions WhatsApp (QR, cookies). **Doit être persistant** entre redémarrages.

> 💡 Le bot crée/valide automatiquement le schéma SQL à l’amorçage (`ensureSchema()`), vous n’avez pas besoin d’exécuter de migrations manuelles.

---

## 4) Installation & Lancement

### Option A — **Docker Compose** (conseillé)

1. (Facultatif) Ajustez `docker-compose.yml` au besoin (volumes, user, etc.).  
   Par défaut, deux volumes sont utilisés :
   - `./data:/app/data`
   - `auth:/app/auth` (volume nommé Docker, persiste les sessions)

2. Construire et démarrer :
   ```bash
   docker compose up --build -d
   ```

3. Consulter les logs pour afficher le QR code (au premier démarrage) :
   ```bash
   docker compose logs -f
   ```

### Option B — **Local (Node.js)**

1. Installer les dépendances :
   ```bash
   npm install
   ```

2. (Linux) Vérifier la présence de Chromium/Chrome. Si nécessaire, indiquez le chemin via la variable d’env. **CHROMIUM_PATH** (ou `PUPPETEER_EXECUTABLE_PATH`) :
   ```bash
   export CHROMIUM_PATH=/usr/bin/google-chrome-stable
   ```

3. Lancer le bot :
   ```bash
   npm start
   ```

4. Le terminal affiche un **QR code** (via `qrcode-terminal`). **Scannez-le avec l’app WhatsApp** (Paramètres → Appareils connectés → Lier un appareil).  
   - Au redémarrage, la session est réutilisée depuis `LOCAL_AUTH_DATA_PATH` (pas besoin de rescanner).

---

## 5) Base de données

- Le bot utilise **MariaDB/MySQL** (pool `mysql2/promise`).  
- Au démarrage, il vérifie la connexion (`pingDb`) puis crée la table principale si elle n’existe pas encore :

  **Table `competitions`** (résumé) :
  - `id` (PK auto)
  - `title`, `date_iso`, `level`, `location`, `slots`
  - `status` (`draft`/`open`/`closed`…)
  - `group_jid`, `invite_code`
  - `open_at`, `close_at`, `note`
  - `announce_chat_jid`, `announce_msg_id`
  - `creator_jid`, `created_at`, `updated_at`

Aucune migration manuelle n’est requise.

---

## 6) Utilisation (aperçu des commandes)

> Les libellés exacts peuvent évoluer, mais le flux général est :

- Dans le **groupe créateur** (`CREATOR_GROUP_ID`) :
  - Envoyez `menu` puis suivez les étapes (ex. `1` pour démarrer une nouvelle compétition).
  - Le bot vous demandera des champs : *nom, lieu, type, date, date de fin d’inscription, note, etc.*
  - Un **récapitulatif** est affiché avant validation.
  - Des commandes d’**ouverture/fermeture** de la compétition et de **suppression** du groupe existent.
- En **message privé**, envoyez `start` si le bot vous le demande, puis revenez dans le groupe créateur.
- Le **groupe visiteurs** peut être utilisé pour des annonces/invitations.

---

## 7) Dépannage

- **Aucun QR n’apparaît / Chromium introuvable**  
  - En local : installez Google Chrome/Chromium et/ou définissez `CHROMIUM_PATH`.  
  - En Docker : l’image inclut Chromium et ses dépendances.

- **Impossible de se connecter à la DB**  
  - Vérifiez `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.  
  - Testez l’accès réseau depuis le conteneur : `docker exec -it Whatsapp_bot sh` puis `nc -zv host port`.

- **Session perdue après redémarrage**  
  - Assurez-vous que `LOCAL_AUTH_DATA_PATH` est **monté** sur un volume persistant (`auth:/app/auth` ou dossier local).

- **Droits Linux**  
  - Sous Docker, le service est lancé avec `user: "0:0"` par défaut. Adaptez si votre hôte impose des UID/GID spécifiques.
  - Si vous exécutez sans Docker, donnez les droits en lecture/écriture au dossier d’auth (`LOCAL_AUTH_DATA_PATH`).

---

## 8) Scripts npm

```json
{
  "scripts": {
    "start": "node src/index.js"
  }
}
```

---

## 9) Mise à jour

1. Arrêtez le service (`docker compose down` ou `Ctrl+C` en local).  
2. Mettez à jour les fichiers (`git pull` / nouvelle archive).  
3. Réinstallez si besoin (`npm ci`/`npm install`).  
4. Redémarrez.

---

## 10) Sécurité & bonnes pratiques

- Déployez sur un hôte de confiance. Le bot contrôle **votre** compte WhatsApp.  
- Restreignez l’accès au groupe créateur.  
- Protégez le `.env` et la base de données.  
- Sauvegardez régulièrement le volume `auth` et la base de données.

---

## 11) Licence

Voir fichier `LICENSE` si présent, sinon considérez ce projet comme interne/privé tant que la licence n’est pas précisée.
