// Bibliothèque de morceaux : gardée dans le navigateur (localStorage).
const KEY = "spt:songs";

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}

export async function listSongs() {
  return Object.values(readAll()).map(meta).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function getSong(id) {
  return (id && readAll()[id]) || null;
}

export async function saveSong(song) {
  const all = readAll();
  all[song.id] = song;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    throw new Error("Le morceau n'a pas pu être enregistré (trop de données dans le navigateur ?).");
  }
}

export async function deleteSong(id) {
  const all = readAll();
  delete all[id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
}

function meta(s) { return { id: s.id, name: s.name, notes: s.parts.reduce((n, p) => n + p.count, 0) }; }
