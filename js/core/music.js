// Théorie musicale de base.
// Une note écrite = { d, acc } :
//   d   = indice diatonique (octave * 7 + degré, degré 0 = do). do4 (do central) = 28.
//   acc = altération : -1 bémol, 0 naturel, 1 dièse.

const LETTERS = {
  latin:   ["do", "ré", "mi", "fa", "sol", "la", "si"],
  english: ["C", "D", "E", "F", "G", "A", "B"],
};
export const SEMI = [0, 2, 4, 5, 7, 9, 11];
export const MIDDLE_C = 28;

// Notation des noms : "latin" (do ré mi) ou "english" (C D E). Réglable depuis l'appli.
let notation = "latin";
export function setNotation(n) { if (LETTERS[n]) notation = n; }
export const names = () => LETTERS[notation];

const SIGNE = { "-1": "♭", "0": "", "1": "♯" };

// Altérations "simples" possibles par degré (pas de mi♯, si♯, do♭, fa♭)
export const CAN_SHARP = [true, true, false, true, true, true, false];
export const CAN_FLAT = [false, true, true, false, true, true, true];

export const degree = (d) => ((d % 7) + 7) % 7;
export const octaveOf = (d) => Math.floor(d / 7);

export function midiOf(note) {
  const d = typeof note === "number" ? note : note.d;
  const acc = typeof note === "number" ? 0 : note.acc || 0;
  return (octaveOf(d) + 1) * 12 + SEMI[degree(d)] + acc;
}

export function noteName(note, withOctave = false) {
  return names()[degree(note.d)] + SIGNE[note.acc || 0] + (withOctave ? octaveOf(note.d) : "");
}

export function diatonicLabel(d) {
  return names()[degree(d)] + octaveOf(d) + (d === MIDDLE_C ? " (central)" : "");
}

// Nom d'une hauteur MIDI quelconque (pour les fausses notes)
const SHARP_MAP = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_MAP  = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
export function midiName(m, prefer = "sharp", withOctave = true) {
  const [deg, acc] = (prefer === "flat" ? FLAT_MAP : SHARP_MAP)[m % 12];
  return names()[deg] + SIGNE[acc] + (withOctave ? Math.floor(m / 12) - 1 : "");
}

export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
