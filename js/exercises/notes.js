// Exercice : notes isolées.
import { randInt, pick, degree, CAN_FLAT, CAN_SHARP } from "../core/music.js";
import { melody, keyName } from "../core/melody.js";

export default {
  id: "notes",
  name: "Notes isolées",
  description: "Une note à la fois : joue la note en couleur.",

  // Valeurs par défaut, rangées sous exercises.notes.*
  defaults: { acc: "none", accRate: 50 },

  // Réglages propres à cet exercice (clés relatives : "acc" → exercises.notes.acc)
  fields: [
    {
      key: "acc", label: "Altérations", type: "choice", when: (s) => !s.get("melodic"),
      options: [
        { value: "none", label: "Aucune" },
        { value: "flat", label: "Bémols" },
        { value: "sharp", label: "Dièses" },
        { value: "both", label: "Les deux" },
      ],
    },
    {
      key: "accRate", label: "Part de notes altérées (%)", type: "number", min: 10, max: 100, step: 10,
      when: (s) => !s.get("melodic") && s.get("exercises.notes.acc") !== "none",
    },
  ],

  // Style d'altération pour nommer les touches noires et les fausses notes
  accidentalStyle: (opts) => (opts.acc === "none" ? "both" : opts.acc),

  // Renvoie `count` colonnes d'une note dans la fourchette `range`
  generate({ count, range, opts, melodic }) {
    // Mode mélodique : petite mélodie dans une tonalité
    if (melodic && melodic.on) {
      const res = melody(count, range, melodic);
      if (res) {
        const columns = res.notes.map((n) => ({ notes: [n], status: "" }));
        columns.keyLabel = keyName(res.key);
        return columns;
      }
    }
    const columns = [];
    let prev = null;
    for (let i = 0; i < count; i++) {
      let d;
      do { d = randInt(range.min, range.max); } while (d === prev && range.max > range.min);
      prev = d;
      columns.push({ notes: [{ d, acc: pickAcc(d, opts) }], status: "" });
    }
    return columns;
  },
};

function pickAcc(d, opts) {
  if (opts.acc === "none" || Math.random() * 100 >= opts.accRate) return 0;
  const deg = degree(d), choices = [];
  if ((opts.acc === "flat" || opts.acc === "both") && CAN_FLAT[deg]) choices.push(-1);
  if ((opts.acc === "sharp" || opts.acc === "both") && CAN_SHARP[deg]) choices.push(1);
  return choices.length ? pick(choices) : 0;
}
