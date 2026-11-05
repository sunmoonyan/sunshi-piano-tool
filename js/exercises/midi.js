// "Exercice" Morceaux : lecteur de fichiers MIDI affichés en partition.
// La logique (import, pistes, défilement) est dans js/core/song.js, js/song-ui.js et js/app.js.

export default {
  id: "midi",
  name: "Morceaux",
  song: true,
  description: "Importe un fichier MIDI et joue-le en suivant la partition.",

  defaults: { songId: "", hands: "both", speed: 1, tails: true },

  fields: [
    {
      key: "hands", label: "Mains à jouer", type: "choice",
      options: [{ value: "right", label: "Main droite" }, { value: "left", label: "Main gauche" }, { value: "both", label: "Les deux" }],
      help: "Les notes de l'autre main restent affichées en gris et passent toutes seules.",
    },
    { key: "speed", label: "Vitesse (1 = tempo du morceau)", type: "number", min: 0.1, max: 2, step: 0.05 },
    { key: "tails", label: "Afficher la durée des notes", type: "toggle" },
  ],

  accidentalStyle: () => "both",
};
