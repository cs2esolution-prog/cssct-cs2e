# Mode opératoire — déployer l'appli pour 2 ou 3 CSSCT indépendants

Option retenue : **une instance complètement séparée par CSSCT** (projet Firebase dédié + site Cloudflare dédié). Aucune donnée n'est jamais partagée entre CSSCT — chaque organisation a sa propre base, ses propres comptes autorisés, son propre nom de domaine.

Contrepartie à garder en tête : le code (HTML/CSS/JS) est aujourd'hui dupliqué à l'identique entre `signalement_liste.html`, `administration.html`, `trousses_secours.html`, etc. — il n'y a pas de "build" qui injecte une config par environnement. Concrètement, **toute correction de bug ou nouvelle fonctionnalité devra être appliquée manuellement sur chaque dépôt** (celui de SMAG, et un par CSSCT supplémentaire), sauf si on bascule un jour vers un dépôt unique avec configuration au runtime (piste d'optimisation, pas nécessaire pour démarrer avec 2-3 instances).

Prévoir environ 45-60 minutes par nouvelle instance une fois la procédure rodée.

## Vue d'ensemble

Pour chaque nouveau CSSCT, il faut créer 4 choses, dans cet ordre :

1. Un projet Firebase dédié (authentification + base de données)
2. Un dépôt Git dédié (copie du code, avec sa propre configuration Firebase et sa propre identité visuelle)
3. Un site Cloudflare Workers dédié (l'hébergement)
4. Les premiers comptes autorisés (au minimum toi-même en tant qu'administrateur)

## Étape 1 — Créer le projet Firebase

1. Va sur [console.firebase.google.com](https://console.firebase.google.com/) et clique sur "Ajouter un projet".
2. Nomme-le clairement, par ex. `cssct-<nom-entreprise>` (garde une trace de ce nom quelque part — tu en auras besoin partout ensuite).
3. Désactive Google Analytics si proposé (pas nécessaire ici) et valide la création.
4. Dans le menu de gauche : **Build > Authentication** → onglet "Sign-in method" → active le fournisseur **Email/Password**, puis dans les paramètres avancés de ce même fournisseur, active **"Lien de messagerie (connexion sans mot de passe)"**. C'est le mode d'authentification déjà utilisé par l'appli (email + lien magique, pas de mot de passe).
5. Toujours dans Authentication → onglet "Settings" → "Authorized domains" : ajoute le futur domaine du site Cloudflare (voir étape 3 — tu pourras revenir compléter cette étape après avoir créé le site, l'ordre n'est pas bloquant).
6. Dans le menu de gauche : **Build > Firestore Database** → "Créer une base de données" → choisis une région proche des utilisateurs (ex. `eur3 (europe-west)`) → démarre en mode production (les règles de sécurité, à copier depuis le projet existant, sont à mettre en place avant tout accès réel — voir encart ci-dessous).
7. Dans les paramètres du projet (roue crantée en haut à gauche > "Paramètres du projet") → onglet "Général" → section "Vos applications" → clique sur l'icône `</>` (Web) → donne un nom (ex. "Appli web") → **ne coche pas** Firebase Hosting (on utilise Cloudflare) → "Enregistrer l'application". Firebase affiche alors un objet `firebaseConfig` avec 6 valeurs (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) : **copie-le intégralement**, il servira à l'étape 2.

> ⚠️ **Règles de sécurité Firestore** : le dépôt actuel ne contient pas les règles de sécurité (elles se configurent uniquement dans la console Firebase, onglet "Règles" de Firestore, pas dans le code). Avant de rendre une instance accessible à qui que ce soit, il faut aller récupérer les règles du projet Firebase existant (`cssct-cs2e-c655b`) dans sa console, et les recopier à l'identique (ou adaptées) dans le nouveau projet. Sans ça, la base sera soit totalement ouverte, soit totalement fermée par défaut selon le mode choisi à la création — dans les deux cas ce n'est pas la configuration voulue. Note-toi cette étape, on peut la détailler ensemble si tu veux que je t'aide à relire les règles actuelles.

## Étape 2 — Créer le dépôt Git de la nouvelle instance

Le plus simple : dupliquer le dépôt actuel dans un nouveau dépôt GitHub, puis adapter la configuration.

1. Sur GitHub, crée un nouveau dépôt vide (ex. `cssct-<nom-entreprise>`), sans README/licence.
2. En local (ou depuis un poste avec Git) :
   ```
   git clone --bare https://github.com/cs2esolution-prog/cssct-cs2e.git
   cd cssct-cs2e.git
   git push --mirror https://github.com/<compte>/cssct-<nom-entreprise>.git
   cd ..
   rm -rf cssct-cs2e.git
   git clone https://github.com/<compte>/cssct-<nom-entreprise>.git
   ```
3. Dans ce nouveau dépôt, remplace l'objet `firebaseConfig` (le bloc à 6 valeurs vu à l'étape 1.7) dans **tous** les fichiers HTML qui le contiennent. À date, cela concerne au moins : `index.html`, `signalement_liste.html`, `nouveau_signalement.html`, `_signalement_formulaire.html`, `signalement_collaborateur.html`, `administration.html`, `dashboard.html`, `inspections.html`, `exercices_evacuation.html`, `comptes_rendus_reunion.html`, `trousses_secours.html`, `import_excel.html`, `a_propos.html`. Une recherche/remplacement global sur `apiKey: "AIzaSyACY8fyy8Rd9NyLJ855xsDyknuUMV-pAag"` (et les 5 autres valeurs qui l'accompagnent) permet de repérer chaque occurrence.
4. Adapte l'identité visuelle pour ce CSSCT :
   - Nom de l'appli : cherche `CS2E · CSSCT` / `Mon appli CSSCT` (titres, `manifest.json`, balises `apple-mobile-web-app-title`) et remplace par le nom voulu.
   - Logos : les constantes `CS2E_LOGO_B64` et `CSSCT_LOGO_B64` dans `signalement_liste.html` (réutilisées dans le rapport imprimé et le `.docx`) sont pour l'instant à remplacer manuellement par les logos de la nouvelle entreprise, converties en base64. **Cette étape sera bien plus simple une fois le paramétrage du logo depuis l'interface développé** (demande déjà notée dans le backlog) — d'ici là, c'est une modification de code à chaque nouvelle instance.
   - Icônes PWA : `manifest.json`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` sont à remplacer par les fichiers de la nouvelle identité (même remarque : sera aussi simplifié par la configuration du logo/icône via l'interface).
5. Adapte `config/mail_relance` par défaut (les constantes `MAIL_RELANCE_DEFAULTS` dans `signalement_liste.html` et `administration.html`) avec le président du CSE et les élus CSSCT de cette organisation — à ajuster ensuite via l'interface d'administration une fois l'instance en ligne.
6. Adapte `wrangler.jsonc` : change la valeur `"name"` (ex. `cssct-<nom-entreprise>`), qui déterminera le sous-domaine Cloudflare par défaut.
7. Commit et push ces changements sur le nouveau dépôt.

## Étape 3 — Créer le site Cloudflare Workers

1. Depuis un poste avec `wrangler` installé (ou via le tableau de bord Cloudflare) et authentifié sur le compte Cloudflare qui hébergera cette instance :
   ```
   cd cssct-<nom-entreprise>
   npx wrangler deploy
   ```
2. Wrangler crée le Worker avec le nom défini dans `wrangler.jsonc` et affiche l'URL `*.workers.dev` attribuée.
3. Retourne dans la console Firebase (Authentication > Settings > Authorized domains, voir étape 1.5) et ajoute cette URL (ou le domaine personnalisé si tu en configures un ensuite) pour que la connexion par lien magique fonctionne.
4. (Optionnel mais recommandé si tu veux un nom propre par client) Configure un domaine personnalisé dans le tableau de bord Cloudflare (Workers & Pages > ton Worker > Settings > Domains & Routes), puis ajoute aussi ce domaine personnalisé aux "Authorized domains" Firebase.

## Étape 4 — Créer les premiers comptes autorisés

Une fois le site en ligne :

1. Console Firebase du nouveau projet → Firestore Database → crée la collection `authorized_emails` (si elle n'existe pas déjà) → ajoute un document dont l'ID est ton adresse email (copie la structure d'un document existant dans le projet SMAG pour rester cohérent).
2. Ouvre le site déployé, saisis ton email, récupère le lien de connexion reçu par mail, connecte-toi une première fois : ton compte Firebase Authentication se crée automatiquement à cette occasion.
3. Une fois connecté, complète la configuration "Mail de relance" dans Administration (président CSE, élus CSSCT de cette organisation) et ajoute les comptes autorisés suivants (collègues élus CSSCT de cette organisation) selon le même principe.

## Récapitulatif à conserver

Pour ne pas se perdre entre plusieurs instances, garde une petite fiche de suivi (par ex. dans ce même dépôt de connaissances) avec, pour chaque CSSCT :

- Nom de l'organisation
- Nom du projet Firebase
- Nom / URL du dépôt Git
- Nom / URL du site Cloudflare
- Domaine personnalisé (si configuré)
- Contacts admin (qui a accès à la console Firebase et au dépôt Git de cette instance)

## Limites à connaître avant de se lancer sur 2-3 instances

- **Maintenance x N** : toute évolution de l'appli (comme celles en cours) doit être reportée manuellement sur chaque dépôt tant qu'il n'y a pas de configuration centralisée. Pour 2-3 CSSCT ça reste gérable, au-delà ce sera à reconsidérer.
- **Règles de sécurité Firestore** : à recopier et vérifier à chaque nouveau projet (étape 1, encart ci-dessus) — c'est la seule vraie barrière de confidentialité entre les CSSCT si jamais un compte se retrouvait mal configuré.
- **Logos et icônes** : tant que la configuration depuis l'interface n'est pas développée, ce sont des modifications de code à chaque nouvelle instance (étape 2.4).
