// "Exercice" Visualisateur : affiche simplement les notes jouées sur la portée (mains gauche
// et droite), sans attendre de note précise. La logique vit dans js/app.js (viewer.*).

export default {
  id: "viewer",
  name: "Visualisateur de notes",
  viewer: true,
  description: "Affiche les notes jouées sur la portée, mains gauche et droite, sans exercice à réussir.",

  // left/right : clé de fa / clé de sol actives (boutons dans la barre de l'exercice)
  defaults: { left: true, right: true },
};
