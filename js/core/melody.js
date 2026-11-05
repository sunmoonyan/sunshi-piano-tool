// Mode mélodique : génère des suites de notes ou d'accords qui sonnent bien.
//
// Principe :
//  1. On choisit une tonalité (majeure ou mineure) et une progression d'accords
//     courante (ex. I – vi – IV – V), qui se termine toujours sur la tonique.
//  2. Mélodie : temps forts sur des notes de l'accord, surtout des mouvements
//     conjoints (notes voisines), un saut est suivi d'un retour en sens inverse,
//     pas d'intervalles durs (triton, seconde augmentée), cadence finale sur la tonique.
//  3. Accords : chaque accord choisit le renversement le plus proche du précédent
//     (conduite des voix), comme le ferait un pianiste.

import { SEMI, degree, midiOf, noteName, pick } from "./music.js";

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

// Tonalités : degré de la tonique (0 = do), altération, mode, nombre d'altérations à la clé
const KEYS = [
  [0, 0, "major", 0], [4, 0, "major", 1], [3, 0, "major", 1], [1, 0, "major", 2], [6, -1, "major", 2],
  [5, 0, "major", 3], [2, -1, "major", 3], [2, 0, "major", 4], [5, -1, "major", 4], [6, 0, "major", 5], [1, -1, "major", 5],
  [5, 0, "minor", 0], [2, 0, "minor", 1], [1, 0, "minor", 1], [6, 0, "minor", 2], [4, 0, "minor", 2],
  [3, 1, "minor", 3], [0, 0, "minor", 3], [0, 1, "minor", 4], [3, 0, "minor", 4], [4, 1, "minor", 5], [6, -1, "minor", 5],
].map(([deg, acc, mode, n]) => ({ deg, acc, mode, n }));

// Progressions (degrés 0 = I). Toutes finissent par une cadence vers I.
const PROGRESSIONS = {
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 0], [5, 3, 0, 4], [0, 3, 1, 4], [0, 1, 4, 0], [0, 5, 1, 4], [0, 3, 0, 4]],
  minor: [[0, 3, 4, 0], [0, 5, 2, 6], [0, 5, 3, 4], [0, 3, 6, 2], [0, 6, 5, 4], [0, 2, 3, 4]],
};

export function pickKey({ mode = "both", maxAcc = 3 } = {}) {
  const ok = KEYS.filter((k) => k.n <= maxAcc && (mode === "both" || k.mode === mode));
  return pick(ok.length ? ok : KEYS.slice(0, 1));
}

export function keyName(key) {
  const name = noteName({ d: key.deg, acc: key.acc });
  return name.charAt(0).toUpperCase() + name.slice(1) + (key.mode === "major" ? " majeur" : " mineur");
}

const tonicPc = (key) => (SEMI[key.deg] + key.acc + 12) % 12;
// position dans la gamme (0 = tonique … 6 = sensible) de la note d
const stepOf = (key, d) => (degree(d) - key.deg + 7) % 7;

// Note écrite { d, acc } de la gamme ; raise = 7e degré haussé (mineur harmonique)
function scaleNote(key, d, raise = false) {
  const k = stepOf(key, d);
  let pc = tonicPc(key) + SCALES[key.mode][k] + (raise && key.mode === "minor" && k === 6 ? 1 : 0);
  const acc = ((pc - SEMI[degree(d)]) % 12 + 18) % 12 - 6;
  return { d, acc };
}

const isChordTone = (key, d, chord) => [0, 2, 4].includes((stepOf(key, d) - chord + 7) % 7);

function weighted(items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) { if ((r -= it.w) <= 0) return it; }
  return items[items.length - 1];
}

function chordPlan(key, length) {
  const prog = pick(PROGRESSIONS[key.mode]);
  return Array.from({ length }, (_, i) => (i === length - 1 ? 0 : prog[Math.floor((i * prog.length) / Math.max(1, length - 1))]));
}

// ---------- Mélodie (notes isolées) ----------
// Renvoie { notes: [{d, acc}], key } ou null si la fourchette est trop petite
export function melody(count, range, keyOpts) {
  if (range.max - range.min < 4) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const key = pickKey(keyOpts);
    const result = tryMelody(count, range, key);
    if (result) return { notes: result, key };
  }
  return null;
}

function tryMelody(count, range, key) {
  const plan = chordPlan(key, count);
  const segStart = plan.map((c, i) => i === 0 || plan[i - 1] !== c);
  const center = (range.min + range.max) / 2, half = Math.max(1, (range.max - range.min) / 2);
  const tonics = [];
  for (let d = range.min; d <= range.max; d++) if (stepOf(key, d) === 0) tonics.push(d);
  if (!tonics.length) return null;

  const raiseAt = (i, d) => key.mode === "minor" && stepOf(key, d) === 6 && (plan[i] === 4 || i === count - 2);
  const out = [];

  for (let i = 0; i < count; i++) {
    const prev = out[i - 1], prev2 = out[i - 2];
    const cands = [];
    const lo = prev ? Math.max(range.min, prev.d - 5) : range.min;
    const hi = prev ? Math.min(range.max, prev.d + 5) : range.max;
    for (let d = lo; d <= hi; d++) {
      const note = scaleNote(key, d, raiseAt(i, d));
      if (Math.abs(note.acc) > 1) continue;
      let w = 1;
      const chordTone = isChordTone(key, d, plan[i]);

      if (!prev) {
        // départ : tonique, tierce ou quinte, plutôt au centre
        if (!isChordTone(key, d, 0)) continue;
        w = stepOf(key, d) === 0 ? 3 : 1.5;
      } else {
        const step = Math.abs(d - prev.d);
        w = [0.25, 4, 2.2, 1, 0.7, 0.3][step];
        // temps fort : note de l'accord ; temps faible : note étrangère seulement par degré conjoint
        if (segStart[i]) w *= chordTone ? 3 : 0.15;
        else if (chordTone) w *= 1.5;
        else if (step !== 1) w *= 0.1;
        // après un saut, on revient par degré conjoint dans l'autre sens
        if (prev2 && Math.abs(prev.d - prev2.d) >= 3) {
          const sameDir = Math.sign(d - prev.d) === Math.sign(prev.d - prev2.d);
          if (sameDir) w *= 0.15; else if (step === 1) w *= 3;
        }
        // intervalles à éviter
        const semis = Math.abs(midiOf(note) - midiOf(prev));
        if (semis === 6) w = 0;                           // triton
        if (step === 1 && semis > 2) w = 0;               // seconde augmentée
        if (step === 0 && prev2 && prev2.d === d) w = 0;  // pas trois fois la même note
      }
      // rester vers le centre de la fourchette
      w *= 1 - 0.6 * Math.min(1, Math.abs(d - center) / half);

      // fin de phrase
      if (i === count - 1) {
        if (stepOf(key, d) !== 0) continue;
        w = prev ? 5 - Math.min(4, Math.abs(d - prev.d)) : 1;
      } else if (i === count - 2) {
        // l'avant-dernière note doit pouvoir rejoindre une tonique proche
        if (!tonics.some((t) => Math.abs(t - d) <= 2)) continue;
        if ([1, 6, 4].includes(stepOf(key, d))) w *= 3;
      }
      if (w > 0) cands.push({ w, note });
    }
    const choice = weighted(cands);
    if (!choice) return null;
    out.push(choice.note);
  }
  return out;
}

// ---------- Accords (triades) ----------
// Renvoie { chords: [{ notes, root, quality, inversion }], key } ou null
export function chordProgression(count, range, keyOpts, inversions = [0, 1, 2]) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const key = pickKey(keyOpts);
    // la progression tourne en boucle, puis cadence parfaite V → I
    const prog = pick(PROGRESSIONS[key.mode]);
    const plan = Array.from({ length: count }, (_, i) => prog[i % prog.length]);
    if (count >= 2) plan[count - 1] = 0;
    if (count >= 3) plan[count - 2] = 4;
    if (count === 2) plan[0] = pick([3, 4]); // IV → I ou V → I
    // pas deux fois le même accord de suite, et pas de V juste avant la cadence V → I
    const pool = [...new Set([...prog, ...(key.mode === "major" ? [0, 1, 3, 4, 5] : [0, 2, 3, 5, 6])])];
    for (let i = 1; i < count - 2; i++) {
      if (plan[i] === plan[i - 1] || plan[i] === plan[i + 1] || (i === count - 3 && plan[i] === 4)) {
        plan[i] = pick(pool.filter((x) => x !== plan[i - 1] && x !== plan[i + 1] && !(i === count - 3 && x === 4)));
      }
    }
    const chords = [];
    let ok = true;
    for (const degreeIdx of plan) {
      const voicings = voicingsFor(key, degreeIdx, range, inversions);
      if (!voicings.length) { ok = false; break; }
      const prev = chords[chords.length - 1];
      let best;
      if (!prev) {
        const mid = (range.min + range.max) / 2;
        voicings.sort((a, b) => Math.abs(avg(a.notes) - mid) - Math.abs(avg(b.notes) - mid));
        best = pick(voicings.slice(0, 2));
      } else {
        voicings.sort((a, b) => distance(prev.notes, a.notes) - distance(prev.notes, b.notes));
        best = Math.random() < 0.8 ? voicings[0] : pick(voicings.slice(0, 2));
      }
      chords.push(best);
    }
    if (ok) return { chords, key };
  }
  return null;
}

function voicingsFor(key, deg, range, inversions) {
  const out = [];
  for (let rootD = range.min - 6; rootD <= range.max; rootD++) {
    if (stepOf(key, rootD) !== deg) continue;
    const raise = deg === 4; // V majeur en mineur (sensible)
    const base = [rootD, rootD + 2, rootD + 4].map((d) => scaleNote(key, d, raise));
    if (base.some((n) => Math.abs(n.acc) > 1)) continue;
    for (const inv of inversions) {
      let notes = base;
      for (let i = 0; i < inv; i++) notes = [...notes.slice(1), { ...notes[0], d: notes[0].d + 7 }];
      if (notes.every((n) => n.d >= range.min && n.d <= range.max)) {
        out.push({ notes, root: base[0], quality: qualityOf(base), inversion: inv });
      }
    }
  }
  return out;
}

function qualityOf([r, t, f]) {
  const a = midiOf(t) - midiOf(r), b = midiOf(f) - midiOf(r);
  if (a === 4 && b === 7) return "maj";
  if (a === 3 && b === 7) return "min";
  if (a === 3 && b === 6) return "dim";
  return "aug";
}

const avg = (notes) => notes.reduce((s, n) => s + n.d, 0) / notes.length;
const distance = (a, b) => a.reduce((s, n, i) => s + Math.abs(midiOf(n) - midiOf(b[i])), 0);
