// Liste des exercices disponibles.
// Pour ajouter un exercice : crée un fichier dans ce dossier (copie notes.js comme modèle),
// puis ajoute-le dans le tableau ci-dessous. Il apparaîtra automatiquement dans le menu.

import notes from "./notes.js";
import triads from "./triads.js";
import midi from "./midi.js";
import viewer from "./viewer.js";

export const EXERCISES = [
  notes,
  triads,
  midi,
  viewer,
];
