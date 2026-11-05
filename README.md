# Sunshi's Piano Tool

Entraînement à la lecture de notes au piano, avec clavier MIDI ou clavier à l'écran.

## Lancer

    ./lancer.sh

puis ouvrir l'adresse affichée (http://localhost:8000 sur le PC, http://IP-du-PC:8000 sur le téléphone).

## Organisation

    index.html            page principale
    css/app.css           apparence (couleurs, thème clair/sombre)
    js/app.js             assemble tout : réglages généraux, vérification des réponses
    js/core/music.js      théorie : noms des notes, hauteurs MIDI, altérations
    js/core/settings.js   réglages sauvegardés + génération automatique du panneau
    js/core/staff.js      dessin de la portée (notes seules ou accords)
    js/core/keyboard.js   clavier à l'écran
    js/core/midi.js       entrée clavier MIDI
    js/core/melody.js     mode mélodique : tonalités, progressions d'accords, mélodies, conduite des voix
    js/exercises/         un fichier par exercice + index.js (la liste)
                          notes.js  : notes isolées
                          triads.js : triades (majeur, mineur, augmenté, diminué)

## Ajouter un exercice (ex. tierces, triades)

1. Copier `js/exercises/notes.js` vers un nouveau fichier, par ex. `triades.js`.
2. Changer `id`, `name`, `description`, `defaults` et `fields` (ses réglages propres).
3. Écrire `generate({ count, range, clef, opts, melodic })` : renvoie `count` colonnes
   `{ notes: [{ d, acc }, ...], status: "" }`. Plusieurs notes = un accord :
   la réponse est validée quand toutes les notes sont jouées ensemble.
4. L'ajouter dans `js/exercises/index.js`. Il apparaît dans le menu et ses réglages dans le panneau.

Types de réglages disponibles : `toggle`, `choice`, `select`, `number`, `noteRange` (voir `js/core/settings.js`).

## Mode mélodique

`generate` reçoit `melodic = { on, mode, maxAcc }`. Si `on` est vrai, utiliser `melody()` ou
`chordProgression()` de `js/core/melody.js`, et mettre `columns.keyLabel` pour afficher la tonalité.

## Comptes

`serveur.py` gère des comptes simples (pseudo + mot de passe haché en PBKDF2).
Sans compte on joue librement, rien n'est enregistré. Avec un compte, réglages,
préréglages et statistiques sont dans `data/users/<pseudo>/`. Le navigateur ne garde
qu'un cookie de connexion (30 jours). Le premier compte créé récupère les anciennes
données de `data/state.json` et `data/stats.jsonl`.
# sunshi-piano-tool
