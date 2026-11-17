// "Exercice" Modificateur de partitions : éditeur de partition MIDI complet — les notes se
// posent directement sur la portée, comme dans un vrai logiciel de notation — pour créer ou
// modifier un morceau, l'exporter en .mid ou en PDF, et le rejouer ensuite dans « Morceaux ».
// La logique vit dans js/editor-ui.js.

export default {
  id: "editor",
  name: "Éditeur de partition",
  editor: true,
  description: "Pose les notes directement sur la portée pour créer ou modifier une partition, exportable en MIDI et en PDF.",
};
