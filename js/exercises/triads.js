// Exercice : triades (accords de trois sons empilés en tierces).
import { randInt, pick, midiOf, noteName, degree, CAN_FLAT, CAN_SHARP } from "../core/music.js";
import { chordProgression, keyName } from "../core/melody.js";

// Demi-tons depuis la fondamentale : [tierce, quinte]
const QUALITIES = {
  maj: { label: "Majeur",   semis: [4, 7], short: "",  long: "majeur" },
  min: { label: "Mineur",   semis: [3, 7], short: "m", long: "mineur" },
  aug: { label: "Augmenté", semis: [4, 8], short: "+", long: "augmenté" },
  dim: { label: "Diminué",  semis: [3, 6], short: "°", long: "diminué" },
};

export default {
  id: "triads",
  name: "Triades",
  description: "Joue l'accord en couleur : toutes ses notes ensemble, ou une par une en arpège.",

  defaults: {
    maj: true, min: true, aug: false, dim: false,
    inv0: true, inv1: false, inv2: false,
    roots: "natural",
    mode: "block",
    chordName: true,
  },

  fields: [
    { key: "maj", label: "Majeur (ex. do – mi – sol)", type: "toggle", when: (s) => !s.get("melodic") },
    { key: "min", label: "Mineur (ex. do – mi♭ – sol)", type: "toggle", when: (s) => !s.get("melodic") },
    { key: "aug", label: "Augmenté (ex. do – mi – sol♯)", type: "toggle", when: (s) => !s.get("melodic") },
    { key: "dim", label: "Diminué (ex. do – mi♭ – sol♭)", type: "toggle", when: (s) => !s.get("melodic") },
    {
      key: "mode", label: "Façon de jouer", type: "choice",
      options: [
        { value: "block", label: "Plaqué" },
        { value: "up", label: "Arpège montant" },
        { value: "down", label: "Arpège descendant" },
        { value: "mixed", label: "Arpège au hasard" },
      ],
    },
    { key: "inv0", label: "Position fondamentale", type: "toggle" },
    { key: "inv1", label: "1er renversement (tierce à la basse)", type: "toggle" },
    { key: "inv2", label: "2e renversement (quinte à la basse)", type: "toggle" },
    {
      key: "roots", label: "Fondamentales", type: "choice", when: (s) => !s.get("melodic"),
      options: [
        { value: "natural", label: "Notes naturelles" },
        { value: "all", label: "Avec ♯ et ♭" },
      ],
    },
    { key: "chordName", label: "Afficher le nom de l'accord sous la portée", type: "toggle" },
  ],

  accidentalStyle: () => "both",

  generate({ count, range, opts, melodic }) {
    const inversionsAllowed = [0, 1, 2].filter((i) => opts["inv" + i]);
    const arpeggio = opts.mode !== "block";
    const nChords = arpeggio ? Math.max(1, Math.floor(count / 3)) : count;

    // Mode mélodique : progression d'accords dans une tonalité, avec conduite des voix
    if (melodic && melodic.on) {
      const res = chordProgression(nChords, range, melodic, inversionsAllowed.length ? inversionsAllowed : [0, 1, 2]);
      if (res) {
        const chords = res.chords.map((c) => describe(c.notes, c.root, c.quality, c.inversion));
        const columns = toColumns(chords, opts);
        columns.keyLabel = keyName(res.key);
        return columns;
      }
    }

    const qualities = Object.keys(QUALITIES).filter((q) => opts[q]);
    if (!qualities.length) qualities.push("maj");
    const inversions = [0, 1, 2].filter((i) => opts["inv" + i]);
    if (!inversions.length) inversions.push(0);

    const chords = [];
    let prevKey = null;

    for (let c = 0; c < nChords; c++) {
      let chord = null;
      for (let tries = 0; tries < 300 && !chord; tries++) {
        const candidate = buildChord(pick(qualities), pick(inversions), range, opts.roots);
        if (candidate && candidate.key !== prevKey) chord = candidate;
      }
      if (!chord) chord = buildChord("maj", 0, null, "natural"); // fourchette trop étroite : on ignore la fourchette
      prevKey = chord.key;
      chords.push(chord);
    }
    return toColumns(chords, opts);
  },
};

// Transforme une liste d'accords en colonnes (plaqué ou arpège)
function toColumns(chords, opts) {
  const columns = [];
  for (const chord of chords) {
    const label = opts.chordName ? chord.short : "";
    if (opts.mode === "block") {
      columns.push({ notes: chord.notes, status: "", label, title: chord.long });
    } else {
      const dir = opts.mode === "mixed" ? pick(["up", "down"]) : opts.mode;
      const seq = dir === "up" ? chord.notes : [...chord.notes].reverse();
      seq.forEach((n, i) => columns.push({ notes: [n], status: "", label: i === 0 ? label : "", title: noteName(n), groupStart: i === 0 }));
    }
  }
  return columns;
}

function describe(notes, root, quality, inversion) {
  const q = QUALITIES[quality];
  const rootName = capitalize(noteName(root));
  return {
    notes,
    short: rootName + (q.short ? " " + q.short : ""),
    long: rootName + " " + q.long + (inversion ? ` (${inversion === 1 ? "1er" : "2e"} renv.)` : ""),
    key: quality + (midiOf(root) % 12) + "-" + inversion,
  };
}

// Construit une triade { notes (grave → aigu), short, long, key } ou null si impossible
function buildChord(quality, inversion, range, roots) {
  const q = QUALITIES[quality];
  const lo = range ? range.min : 21, hi = range ? range.max : 42;
  const rootD = randInt(lo - 6, hi);
  let rootAcc = roots === "all" ? pick([-1, 0, 0, 1]) : 0;
  if ((rootAcc === 1 && !CAN_SHARP[degree(rootD)]) || (rootAcc === -1 && !CAN_FLAT[degree(rootD)])) rootAcc = 0;
  const root = { d: rootD, acc: rootAcc };
  const rootMidi = midiOf(root);

  const third = spell(rootD + 2, rootMidi + q.semis[0]);
  const fifth = spell(rootD + 4, rootMidi + q.semis[1]);
  if (!third || !fifth || Math.abs(rootAcc) > 1) return null;

  let notes = [root, third, fifth];
  // renversement : on monte la ou les notes du bas d'une octave
  for (let i = 0; i < inversion; i++) {
    const [first, ...rest] = notes;
    notes = [...rest, { d: first.d + 7, acc: first.acc }];
  }
  if (range && notes.some((n) => n.d < range.min || n.d > range.max)) return null;

  return describe(notes, root, quality, inversion);
}

// Écrit la note de degré `d` qui sonne `midi` ; null si cela demande un double ♯/♭
function spell(d, midi) {
  const acc = midi - midiOf(d);
  return Math.abs(acc) <= 1 ? { d, acc } : null;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
