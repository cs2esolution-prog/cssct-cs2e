# Mode opératoire — créer une nouvelle instance CSSCT

Chaque CSSCT a sa propre instance, complètement séparée : projet Firebase dédié, site Cloudflare dédié, dépôt GitHub dédié. Aucune donnée n'est jamais partagée entre CSSCT. Tout se fait depuis les sites web (aucun logiciel à installer, aucune ligne de commande), avec des comptes dédiés à l'organisation, et non ton compte personnel. Prévoir environ 1 h 30 la première fois.

## Étape 0 — Créer les comptes de l'organisation

1. Choisis une adresse e-mail dédiée à l'organisation (pas ton adresse personnelle), qui servira de propriétaire de l'instance.
2. Crée avec cette adresse : un compte Google (pour Firebase), un compte GitHub (le code), un compte Cloudflare (l'hébergement) et un compte Mailjet (l'envoi des e-mails).
3. Note les identifiants dans un gestionnaire de mots de passe, jamais dans un fichier du dépôt.

> Ces comptes appartiennent ensuite à l'organisation : tu peux lui en transmettre la gestion en changeant l'adresse e-mail ou en ajoutant un administrateur dans chaque service.

## Étape 1 — Projet Firebase (compte Google dédié)

1. Sur `console.firebase.google.com`, crée un projet nommé par ex. `cssct-<nom-organisation>`. Désactive Google Analytics.
2. Authentication → Sign-in method → active **Email/Password**, puis dans ses paramètres avancés active **« Lien de messagerie (connexion sans mot de passe) »**.
3. Firestore Database → Créer une base → région proche (ex. `eur3`) → mode production.
4. Firestore Database → onglet **Règles** → remplace tout le contenu par le fichier `firestore.rules` à jour, puis **Publier**. Ce fichier se trouve dans les Connaissances du projet Claude « CSSCT — Suivi & Signalements » (`claude/firestore-regles-a-jour.txt`, copie des règles actuellement publiées) ; il contient aussi le bloc des notifications (`abonnements_push`). Le fichier `claude/firestore.rules` plus ancien est périmé : ne l'utilise pas.
5. Paramètres du projet (roue crantée) → Général → « Vos applications » → icône `</>` (Web) → nom libre, **sans** Firebase Hosting → Enregistrer. Firebase affiche 6 valeurs (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) : recopie-les dans un bloc-notes, elles servent à l'étape 2.
6. Authentication → Settings → Authorized domains : tu ajouteras le domaine du site à l'étape 3.

> Sans les règles de l'étape 1.4, la base est soit ouverte à tous, soit fermée : ne donne l'adresse du site à personne avant de les avoir publiées.

## Étape 2 — Dépôt GitHub (compte GitHub dédié)

1. Sur le dépôt d'origine (ton compte) : bouton **Code** → **Download ZIP**, puis dézippe le fichier sur ton ordinateur.
2. Connecte-toi au compte GitHub dédié → **New repository** → nom `cssct-<nom-organisation>`, **Private**, sans README → Create. Sur la page du dépôt vide, clique **uploading an existing file**, glisse tout le contenu dézippé (dossier `src` compris), puis **Commit changes**.
3. Sur la page du dépôt, appuie sur la touche **point (.)** : l'éditeur web s'ouvre. Clique sur la loupe à gauche (Rechercher), puis sur la flèche à gauche du champ pour afficher « Remplacer ». Fais les remplacements du tableau ci-dessous, **dans cet ordre**, avec « Tout remplacer » (une icône à droite du champ) :
   Remplacements, dans cet ordre :
   - 1. Chercher `1:277603883255:web:b3b7a5c3097a60caac1bf2` → remplacer par le nouvel `appId`.
   - 2. Chercher `277603883255` → remplacer par le nouveau `messagingSenderId`.
   - 3. Chercher `AIzaSyACY8fyy8Rd9NyLJ855xsDyknuUMV-pAag` → remplacer par la nouvelle `apiKey`.
   - 4. Chercher `cssct-cs2e-c655b` → remplacer par le nouveau `projectId` (remplace aussi `authDomain`, `storageBucket` et les liens de la console).
   - 5. Chercher `cdizien@agrosolutions.com;imariotti@smag.tech;choudayer@smag.tech` → remplacer par les adresses des élus CSSCT de l'organisation, séparées par `;` (2 fichiers).
   - 6. Chercher `alhermitte@smag.tech` → remplacer par l'adresse du président du CSE.
   - 7. Chercher `choudayer@smag.tech` → remplacer par l'adresse qui reçoit les notifications de secours (administrateur).
   - 8. Chercher `cs2esolution@gmail.com` → remplacer par l'adresse d'expédition validée dans Mailjet (même valeur que `MAILJET_FROM_EMAIL`).
   - 9. Chercher `["Bezannes","Chalons-en-Champagne","Evreux","Milly-la-Forêt","Montpellier","Nancy","Paris","Poitiers","Reims","Télétravail","Wavre"]` → remplacer par `["Site principal"]` ou la liste de l'organisation (8 fichiers).
   - 10. Chercher `["Smag","Agrinovex","Fermes Leader","Be API","Agrosolutions","Carbon & Co"]` → remplacer par `["Nom de l'organisation"]` ou la liste de l'organisation (4 fichiers).
   - 11. Chercher `Mon appli CSSCT` → remplacer par le nom de l'application.
4. Contrôle : cherche `c655b` → les seuls résultats admis sont dans le texte de ce mode opératoire (`administration.html` et `mode-operatoire-multi-cssct.md`). Cherche aussi `smag` et `agrosolutions` pour repérer les exemples restants (sans impact sur le fonctionnement).
5. Compare dans `index.html` le bloc `firebaseConfig` avec les 6 valeurs notées à l'étape 1 : `authDomain` et `storageBucket` doivent y être identiques. Sinon, corrige-les dans les 20 fichiers (cherche l'ancienne valeur) ou demande de l'aide à Claude.
6. Remplace les images `icon-192.png` et `apple-touch-icon.png` par celles de l'organisation, ainsi que `icon-512.png` s'il est présent (le manifeste le cite). Dans GitHub : page du dépôt → Add file → Upload files, en gardant exactement les mêmes noms.
7. Dans l'éditeur web, onglet **Source Control** (à gauche) → écris un message → **Commit & Push**.

> Décide liste par liste (sites, entreprises, destinataires) si tu reprends celle d'origine ou si tu pars vierge. Une fois l'instance en ligne, ces listes se modifient sans toucher au code : Administration → Sites, Entreprises, Mail de relance.

## Étape 3 — Hébergement Cloudflare (compte Cloudflare dédié)

1. Cloudflare → **Storage & Databases** → **KV** → Create instance → nom `CR_FILES`. Copie l'**ID** affiché sur sa page.
2. Dans l'éditeur web du dépôt (touche **point**), ouvre `wrangler.jsonc` : remplace l'`id` situé à côté de `"binding": "CR_FILES"` par l'ID copié, et la valeur de `"name"` par `cssct-<nom-organisation>` (minuscules, chiffres et tirets). Commit & Push.
3. Cloudflare → **Workers & Pages** → **Create** → **Import a repository** (ou « Connect to Git ») → autorise le compte GitHub dédié → choisis le dépôt. Le nom du Worker doit être **exactement** celui de `wrangler.jsonc`. Laisse les commandes de build vides → **Deploy**.
4. Note l'adresse `*.workers.dev` obtenue. Ajoute-la dans Firebase → Authentication → Settings → **Authorized domains** (étape 1.6). Si tu utilises un domaine personnalisé (Worker → Settings → Domains & Routes), ajoute-le aussi.
5. Worker → Settings → **Triggers** : une planification `0 * * * *` (toutes les heures) doit apparaître. Elle déclenche les rappels quotidiens des notifications ; si elle manque, vérifie que `wrangler.jsonc` contient la ligne `triggers`.
6. Worker → Settings → Bindings : `CR_FILES` doit apparaître comme lié (KV).

> Une fois le dépôt relié, chaque modification validée (commit) dans GitHub redéploie automatiquement le site : c'est ainsi que se déposent ensuite les mises à jour.

## Étape 4 — E-mails (Mailjet)

1. Mailjet → crée une clé API (API key + Secret key) et **valide l'adresse d'expédition** (Sender addresses) : sans validation, Mailjet refuse d'envoyer.
2. Cloudflare → le Worker → Settings → **Variables and Secrets** → Add → type **Secret** (jamais en clair, jamais dans GitHub) : `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAILJET_FROM_EMAIL` (l'adresse validée), `MAILJET_FROM_NAME` (nom affiché). Puis **Deploy**.
3. À vérifier plus tard avec un signalement de test : l'e-mail doit arriver. Sinon, les journaux du Worker (Observability / Logs) affichent l'erreur Mailjet.

> Étape facile à oublier : sans elle, l'application fonctionne mais n'envoie aucun e-mail, sans erreur visible pour l'utilisateur. Les secrets sont conservés lors des mises à jour.

## Étape 5 — Compte de service Firebase (accès privilégié du Worker)

1. Sur `console.cloud.google.com`, sélectionne le projet de cette instance (même nom que le projet Firebase).
2. IAM et administration → Comptes de service → Créer un compte de service (ex. `worker-acces`), rôle **Cloud Datastore User**. Onglet Clés → Ajouter une clé → JSON → télécharge le fichier (jamais dans GitHub ; il ne peut pas être retéléchargé).
3. Cloudflare → le Worker → Settings → Variables and Secrets → type **Secret** : `GOOGLE_SERVICE_ACCOUNT_KEY` = tout le contenu du fichier JSON ; `CR_ACCESS_SECRET` = une longue chaîne aléatoire (générateur de mot de passe). **Deploy**. Supprime ensuite le fichier JSON de ton ordinateur.
4. À vérifier : Administration → CR réunion → Accès collaborateurs : définis un mot de passe test, ouvre `cr_reunion_collaborateurs.html` en navigation privée et confirme qu'il est accepté.

> Ce compte est nécessaire pour deux fonctions : les comptes rendus protégés par mot de passe et **toutes les notifications** (immédiates et rappels quotidiens). Sans lui, l'erreur est explicite (`GOOGLE_SERVICE_ACCOUNT_KEY absent`) et le reste de l'application fonctionne.

## Étape 6 — Premiers comptes

1. Firebase → Firestore → crée la collection `authorized_emails` avec un document dont l'identifiant est ton adresse e-mail (en minuscules).
2. Ouvre le site, saisis ton adresse, clique sur le lien reçu par e-mail : tu es connecté.
3. Administration → Comptes autorisés & administrateurs : la liste des administrateurs est vide au départ (« mode bootstrap »), nomme-toi premier administrateur en priorité. Ajoute ensuite les autres comptes et la configuration du mail de relance.

## Étape 7 — Notifications sur téléphone

1. Administration → **Générer les clés de notification** : copie les deux valeurs affichées (elles ne sont enregistrées nulle part).
2. Cloudflare → le Worker → Variables and Secrets : `VAPID_PUBLIC` en variable de type **texte**, `VAPID_PRIVATE` en **secret**. Facultatif : `VAPID_SUBJECT` (`mailto:adresse`) et `FUSEAU_HORAIRE` (par défaut `Europe/Paris`, pour l'heure des rappels). **Deploy**.
3. Administration → **Vérifier la configuration** : doit afficher « Configuration correcte ». Sinon le message dit ce qui manque.
4. Chaque membre ouvre « Notifications » (cloche de l'accueil), active son appareil puis touche « Envoyer un test ». Sur iPhone, l'application doit d'abord être installée sur l'écran d'accueil (iOS 16.4 ou plus récent).
5. Chaque appareil a ses réglages : heure du rappel quotidien (9 h par défaut) et familles de notifications. Les rappels portent sur les trousses (péremptions, contrôles) et les signalements non clos depuis plus de 30 jours.
6. Ne régénère jamais les clés d'une instance en service : tous les appareils devraient être réactivés un par un.

## Vérifications finales

1. Dépose un signalement depuis le portail salarié : e-mail reçu, notification reçue sur un téléphone abonné, dossier visible dans l'application.
2. Administration → Sites et Entreprises : les listes sont celles de l'organisation (ou vierges), pas celles d'origine.
3. La recherche `c655b` dans l'éditeur web du dépôt ne trouve plus rien en dehors du texte de ce mode opératoire.

## Limites

Limites : le code est dupliqué entre les instances. Chaque évolution livrée pour l'instance d'origine (fichiers à déposer dans GitHub) doit aussi être déposée dans le dépôt de chaque copie. Les intitulés des menus de Firebase, GitHub et Cloudflare évoluent : en cas de doute, cherche le mot-clé dans la barre de recherche du service. Garde une fiche par instance : organisation, projet Firebase, dépôt GitHub, nom du Worker et adresse du site, domaine personnalisé, adresse e-mail propriétaire des comptes.
