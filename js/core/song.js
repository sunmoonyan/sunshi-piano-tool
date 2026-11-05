// Morceaux MIDI : conversion d'un fichier en "morceau", attribution des pistes aux mains,
// transformation en colonnes pour la portée, et horloge (secondes → position).

import { parseMidi, instrumentName } from "./midifile.js";
import { noteName } from "./music.js";

export const SLOTS_PER_BEAT = 2;   // une colonne d'espace par croche
export const LEAD_SLOTS = 3;       // le morceau commence 3 colonnes après la zone de lecture

// ---------- Import ----------
export function songFromMidi(buffer, fileName) {
  const midi = parseMidi(buffer);
  const parts = [];
  for (const t of midi.tracks) {
    if (!t.notes.length) continue;
    // format 0 : une seule piste contenant plusieurs canaux → une partie par canal
    const byCh = t.channels.length > 1 ? t.channels.map((ch) => t.notes.filter((n) => n.ch === ch)) : [t.notes];
    byCh.forEach((notes, i) => {
      if (!notes.length) return;
      const ch = notes[0].ch;
      const pitches = notes.map((n) => n.midi);
      parts.push({
        id: `t${t.index}c${ch}`,
        name: (t.name || `Piste ${t.index + 1}`) + (byCh.length > 1 ? ` – canal ${ch + 1}` : ""),
        instrument: instrumentName(t, ch),
        drums: ch === 9,
        count: notes.length,
        min: Math.min(...pitches),
        max: Math.max(...pitches),
        avg: pitches.reduce((s, x) => s + x, 0) / pitches.length,
        notes: notes.map((n) => [n.midi, n.tick, n.dur]),
      });
    });
  }
  if (!parts.length) throw new Error("Ce fichier MIDI ne contient aucune note.");
  const base = fileName.replace(/\.(mid|midi)$/i, "").replace(/[_]+/g, " ").trim();
  const song = {
    id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: base || "Morceau",
    ppq: midi.ppq,
    tempos: midi.tempos,
    timeSigs: midi.timeSigs,
    keySig: midi.keySig,
    endTick: midi.endTick,
    parts,
    config: { hands: {}, split: 60 },
  };
  song.config.hands = guessHands(parts);
  return song;
}

// Proposition automatique : la partie la plus aiguë à droite, la plus grave à gauche,
// une seule partie → séparée au do central ; batterie et autres parties ignorées.
export function guessHands(parts) {
  const hands = {};
  const usable = parts.filter((p) => !p.drums).sort((a, b) => b.avg - a.avg);
  parts.forEach((p) => { hands[p.id] = "ignore"; });
  if (usable.length === 1) hands[usable[0].id] = "split";
  else if (usable.length >= 2) {
    hands[usable[0].id] = "right";
    hands[usable[usable.length - 1].id] = "left";
  }
  return hands;
}

// ---------- Écriture des notes ----------
// Orthographe des notes noires selon l'armure (bémols si l'armure en a, sinon la plus courante)
const SHARPS = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLATS = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
const COMMON = [[0, 0], [0, 1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [6, -1], [6, 0]];

function spell(midi, map) {
  const [deg, acc] = map[midi % 12];
  return { d: (Math.floor(midi / 12) - 1) * 7 + deg, acc };
}

// Orthographe courante d'une note MIDI jouée en direct (hors contexte de tonalité)
export function spellMidi(midi) {
  return spell(midi, COMMON);
}

export function keyLabel(song) {
  const ks = song.keySig;
  if (!ks) return "";
  const majors = ["do♭", "sol♭", "ré♭", "la♭", "mi♭", "si♭", "fa", "do", "sol", "ré", "la", "mi", "si", "fa♯", "do♯"];
  const minors = ["la♭", "mi♭", "si♭", "fa", "do", "sol", "ré", "la", "mi", "si", "fa♯", "do♯", "sol♯", "ré♯", "la♯"];
  const n = (ks.minor ? minors : majors)[ks.sf + 7];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) + (ks.minor ? " mineur" : " majeur") : "";
}

// ---------- Colonnes pour la portée ----------
// hands : "right" | "left" | "both" (mains à jouer). Les notes de l'autre main sont affichées en gris.
export function songColumns(song, hands) {
  const map = song.keySig ? (song.keySig.sf < 0 ? FLATS : song.keySig.sf > 0 ? SHARPS : COMMON) : COMMON;
  const all = [];
  for (const part of song.parts) {
    const role = song.config.hands[part.id] || "ignore";
    if (role === "ignore") continue;
    for (const [midi, tick, dur] of part.notes) {
      const hand = role === "split" ? (midi >= song.config.split ? "right" : "left") : role;
      all.push({ midi, tick, dur, hand });
    }
  }
  all.sort((a, b) => a.tick - b.tick || a.midi - b.midi);

  // notes jouées ensemble (à une triple croche près) = une colonne
  const tol = song.ppq / 8;
  const bars = barTicks(song);
  let bi = 0;
  const columns = [];
  for (const n of all) {
    let col = columns[columns.length - 1];
    if (!col || n.tick - col.tick > tol) {
      col = { tick: n.tick, notes: [], status: "", groupStart: false };
      while (bi < bars.length && bars[bi] <= n.tick + tol) { col.groupStart = true; bi++; }
      columns.push(col);
    }
    if (col.notes.some((x) => x.midi === n.midi && x.hand === n.hand)) continue; // doublon
    const written = spell(n.midi, map);
    col.notes.push({ ...written, midi: n.midi, staff: n.hand === "right" ? "treble" : "bass", hand: n.hand,
      other: hands !== "both" && n.hand !== hands, len: (n.dur / song.ppq) * SLOTS_PER_BEAT });
  }
  for (const col of columns) {
    col.k = LEAD_SLOTS + (col.tick / song.ppq) * SLOTS_PER_BEAT;
    col.auto = col.notes.every((n) => n.other);   // rien à jouer : passe tout seul
    col.title = col.notes.filter((n) => !n.other).map((n) => noteName(n)).join(" – ");
  }
  if (columns[0]) columns[0].groupStart = true;
  return columns;
}

function barTicks(song) {
  const bars = [];
  const sigs = song.timeSigs.length ? song.timeSigs : [{ tick: 0, num: 4, den: 4 }];
  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i];
    const len = song.ppq * 4 * s.num / s.den;
    const end = i + 1 < sigs.length ? sigs[i + 1].tick : song.endTick + len;
    for (let t = s.tick; t < end && len > 0; t += len) bars.push(t);
  }
  return bars;
}

// Notes (MIDI) couvertes par le morceau, pour la portée et le clavier
export function songRange(columns) {
  let min = 127, max = 0;
  for (const c of columns) for (const n of c.notes) { min = Math.min(min, n.d); max = Math.max(max, n.d); }
  return min > max ? { min: 21, max: 38 } : { min, max };
}

// ---------- Horloge : secondes du morceau → position en colonnes ----------
export function makeClock(song) {
  const segs = [];
  let sec = 0;
  song.tempos.forEach((t, i) => {
    if (i > 0) sec += ((t.tick - song.tempos[i - 1].tick) / song.ppq) * (song.tempos[i - 1].uspq / 1e6);
    segs.push({ sec, tick: t.tick, spb: t.uspq / 1e6 });
  });
  const first = segs[0];
  const leadSec = (LEAD_SLOTS / SLOTS_PER_BEAT) * first.spb;
  return {
    leadSec,
    duration: leadSec + tickToSec(song.endTick),
    tickToSec,
    // s = temps depuis le début (lancement compris)
    posAt(s) {
      const t = s - leadSec;
      if (t <= 0) return LEAD_SLOTS + (t / first.spb) * SLOTS_PER_BEAT;
      let seg = first;
      for (const g of segs) { if (g.sec <= t) seg = g; else break; }
      const tick = seg.tick + ((t - seg.sec) / seg.spb) * song.ppq;
      return LEAD_SLOTS + (tick / song.ppq) * SLOTS_PER_BEAT;
    },
  };
  function tickToSec(tick) {
    let seg = first;
    for (const g of segs) { if (g.tick <= tick) seg = g; else break; }
    return seg.sec + ((tick - seg.tick) / song.ppq) * seg.spb;
  }
}

export function bpmOf(song) { return Math.round(60 / (song.tempos[0].uspq / 1e6)); }
