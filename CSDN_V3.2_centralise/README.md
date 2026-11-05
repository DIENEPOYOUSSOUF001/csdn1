# CSDN V3.2 — Accès sécurisé + données centralisées

## Ce qui change
- **Connexion obligatoire** : à la toute première ouverture, l'application demande de créer le compte administrateur (nom + mot de passe, 8 caractères minimum). Ensuite chaque personne se connecte avec son nom et son mot de passe.
- **Données centralisées** : tout est enregistré sur le serveur (Netlify Blobs). Chaque modification est envoyée automatiquement ; chaque PC reçoit les changements des autres toutes les 15 secondes. Le badge en haut indique « Synchronisé », « Hors ligne » ou le nombre de modifications en attente.
- **Accès horodaté** : Paramètres > Accès et sécurité (administrateur) : journal des connexions, échecs, modifications, avec date, heure (Bamako), appareil et adresse IP. Chaque fiche garde aussi qui l'a modifiée en dernier et quand.
- **Utilisateurs** : l'administrateur crée des comptes, réinitialise des mots de passe, désactive un compte (effet immédiat).
- **Sauvegarde automatique du serveur** (une par jour, 30 jours conservés), téléchargeable depuis le même panneau.
- Les données des élèves ne sont **plus publiques** : `seed-data.js` n'existe plus sur le site, son contenu n'est servi qu'après connexion.
- Verrouillage après 30 minutes d'inactivité. 5 mauvais mots de passe = blocage de 15 minutes.
- Deux PC qui encaissent en même temps avec le même numéro de reçu : le serveur renumérote le second et prévient.

## Déploiement (important)
Les fonctions serveur ont besoin d'installer `@netlify/blobs`. **Le glisser-déposer d'un ZIP ne le fait pas** : il faut l'une de ces deux méthodes.

**A. Via GitHub (recommandé, le plus simple)**
1. Créez un dépôt GitHub privé et envoyez-y le contenu de ce dossier.
2. Netlify > Add new site > Import from Git > choisissez le dépôt. Aucun réglage à changer (netlify.toml suffit).
3. Pour garder votre adresse actuelle, liez le dépôt à votre site existant (Site configuration > Build & deploy > Link repository).

**B. Via la ligne de commande**
```
npm install
npm install -g netlify-cli
netlify login
netlify link        (choisir le site existant)
netlify deploy --prod
```

Optionnel : variable d'environnement `SETUP_CODE` (Site configuration > Environment variables) pour exiger un code lors de la création du premier compte, afin que personne ne puisse le créer avant vous.

## Première utilisation (ordre à respecter)
1. **Faites d'abord une sauvegarde JSON** dans l'ancienne version.
2. Ouvrez le site **sur le PC qui contient vos vraies données** et créez le compte administrateur : ses données locales deviennent la base centrale.
3. Sur les autres PC : connectez-vous avec un compte créé par l'administrateur. S'ils ont des données locales anciennes, les paiements/dépenses absents du serveur sont ajoutés ; en cas de fiche différente, la version centrale est gardée et une copie locale est téléchargée automatiquement.

## Limites à connaître
- Un PC hors ligne peut continuer à travailler ; ses modifications partent au retour d'Internet. Se connecter ou démarrer à froid exige Internet.
- En cas de modification de la même fiche sur deux PC, la plus récente gagne (fiche par fiche).
- Se déconnecter efface la copie locale de ce navigateur (sauf modifications non envoyées : l'application prévient).
- « Restaurer » est réservé à l'administrateur et remplace les données de **tous** les postes. Le serveur garde une copie de l'état précédent.
- Testé : serveur (30 vérifications), 2 navigateurs simulés (26 vérifications). **Non testé sur le vrai Netlify** : faites un essai (création du compte, un paiement sur chaque PC) avant l'usage en caisse.
