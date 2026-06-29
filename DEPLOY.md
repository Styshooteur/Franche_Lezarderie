# Guide de déploiement — Lezardière de la Confrérie

Ce guide vous accompagne **pas à pas** pour :
1. Créer la base Supabase
2. Configurer les codes d'invitation
3. Mettre le site en ligne sur Render (gratuit)

---

## Vue d'ensemble

```
Joueurs → Render (site + chat) → Supabase (base de données)
```

**2 services gratuits**, pas de Vercel.

---

## ÉTAPE 1 — Créer un compte Supabase

1. Allez sur [https://supabase.com](https://supabase.com)
2. Cliquez **Start your project**
3. Connectez-vous avec **GitHub** (recommandé)
4. Cliquez **New project**
5. Remplissez :
   - **Name** : `lezardiere` (ou autre)
   - **Database Password** : choisissez un mot de passe fort → **notez-le**
   - **Region** : `West EU (Paris)` si disponible
6. Cliquez **Create new project** (attendre 1–2 minutes)

---

## ÉTAPE 2 — Récupérer l'URL de connexion

1. Dans Supabase, menu gauche → **Project Settings** (engrenage)
2. **Database** → section **Connection string**
3. Onglet **URI**
4. Copiez la chaîne qui ressemble à :
   ```
   postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```
5. Remplacez `[YOUR-PASSWORD]` par votre mot de passe réel

Gardez cette URL — c'est votre `DATABASE_URL`.

---

## ÉTAPE 3 — Préparer le projet sur GitHub

### 3.1 Installer Git (si pas déjà fait)

Téléchargez Git : [https://git-scm.com/download/win](https://git-scm.com/download/win)

### 3.2 Créer un dépôt GitHub

1. [https://github.com/new](https://github.com/new)
2. Nom : `lezardiere-confrerie`
3. **Private** (recommandé pour un chat RP privé)
4. Créez le dépôt **sans** README

### 3.3 Envoyer votre code

Dans PowerShell, dans le dossier du projet :

```powershell
cd "c:\Users\PC\Desktop\IRC-France Lezarderie"
git init
git add .
git commit -m "Lezardière — chat RP avec lézards messagers"
git branch -M main
git remote add origin https://github.com/VOTRE-PSEUDO/lezardiere-confrerie.git
git push -u origin main
```

Remplacez `VOTRE-PSEUDO` par votre identifiant GitHub.

---

## ÉTAPE 4 — Configurer les codes d'invitation

### En local (fichier)

1. Copiez `invites.example.json` → `invites.json` (déjà fait si vous testez en local)
2. Modifiez le code :

```json
{
  "codes": [
    {
      "code": "VOTRE-CODE-SECRET",
      "maxUses": null,
      "expiresAt": null
    }
  ]
}
```

- `maxUses: null` = utilisations illimitées (idéal pour un code unique partagé)
- `expiresAt: null` = pas de date d'expiration

### Sur Render (variable d'environnement)

Sur Render, le fichier `invites.json` n'est **pas** versionné (sécurité).
Utilisez plutôt la variable :

```
INVITE_CODES=VOTRE-CODE-SECRET
```

---

## ÉTAPE 5 — Tester en local (optionnel mais recommandé)

1. Copiez `.env.example` → `.env`
2. Remplissez dans `.env` :
   ```
   DATABASE_URL=postgresql://... (votre URL Supabase)
   SESSION_SECRET=une-longue-chaine-aleatoire-32-caracteres-minimum
   ```
3. Installez les dépendances :
   ```powershell
   npm install
   ```
4. Lancez :
   ```powershell
   npm run dev
   ```
5. Ouvrez [http://localhost:3000](http://localhost:3000)
6. Entrez le code d'invitation + un pseudo

---

## ÉTAPE 6 — Déployer sur Render

### 6.1 Créer un compte

1. [https://render.com](https://render.com)
2. Inscrivez-vous avec **GitHub**

### 6.2 Créer le Web Service

1. Dashboard → **New +** → **Web Service**
2. Connectez votre dépôt `lezardiere-confrerie`
3. Paramètres :
   - **Name** : `lezardiere`
   - **Region** : Frankfurt ou closest
   - **Branch** : `main`
   - **Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : **Free**

### 6.3 Variables d'environnement

Dans **Environment** → **Add Environment Variable** :

| Clé | Valeur |
|-----|--------|
| `DATABASE_URL` | Votre URI Supabase (étape 2) |
| `SESSION_SECRET` | Chaîne aléatoire longue (ex. générée sur [random.org](https://www.random.org/strings/)) |
| `INVITE_CODES` | Votre code secret (ex. `CONFRERIE-2026`) |
| `NODE_ENV` | `production` |

### 6.4 Déployer

Cliquez **Create Web Service**. Render installe et lance l'app (5–10 min la première fois).

Votre URL sera du type :
```
https://lezardiere.onrender.com
```

---

## ÉTAPE 7 — Vérifier que tout fonctionne

1. Ouvrez l'URL Render
2. Entrez le **code d'invitation**
3. Choisissez un **pseudo** (définitif)
4. Envoyez un message lézard
5. Ouvrez une **fenêtre de navigation privée** → deuxième pseudo → vérifiez le chat

---

## Comportement des codes et sessions

| Situation | Que se passe-t-il ? |
|-----------|---------------------|
| Première visite | Code + pseudo demandés |
| Retour (même navigateur) | Connexion automatique (cookie ~60 jours) |
| Cookies effacés | Code redemandé, **même pseudo impossible** si déjà pris |
| Pseudo | **Définitif**, ne peut pas être changé |

---

## Limites du plan gratuit Render

- Le site **s'endort** après ~15 min sans visite
- Premier accès après veille : **30 s à 1 min** de réveil
- Acceptable pour une Confrérie RP, pas pour un chat public massif

---

## Changer le code d'invitation plus tard

1. Render → votre service → **Environment**
2. Modifiez `INVITE_CODES`
3. **Save Changes** → Render redéploie automatiquement

Pour plusieurs codes :
```
INVITE_CODES=CODE1,CODE2,CODE3
```

---

## Dépannage

### « DATABASE_URL manquant »
→ Vérifiez la variable d'environnement sur Render.

### « Code d'invitation invalide »
→ Vérifiez `INVITE_CODES` sur Render ou `invites.json` en local.

### « Cette identité est déjà prise »
→ Normal : les pseudos sont uniques et définitifs.

### Le site ne se connecte pas à Supabase
→ Vérifiez le mot de passe dans l'URL. Utilisez la connexion **Session pooler** (port 6543).

### Chat ne se connecte pas (point rouge)
→ Attendez le réveil Render, ou vérifiez les logs Render → **Logs**.

---

## Résumé des fichiers importants

| Fichier | Rôle |
|---------|------|
| `invites.json` | Codes en local (non versionné) |
| `.env` | Secrets en local (non versionné) |
| `invites.example.json` | Modèle de codes |
| `.env.example` | Modèle de configuration |
| `server.js` | Serveur chat + sessions |
| `db.js` | Connexion Supabase |

---

## Prochaines étapes possibles

- Nom de domaine personnalisé (Render → Settings → Custom Domain)
- Page admin pour gérer les codes (option B)
- Codes à usage unique pour recrutements RP
