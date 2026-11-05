// Bibliothèque de morceaux : enregistrés sur le serveur avec un compte, en mémoire sinon.
import { store } from "./store.js";

const memory = new Map(); // id -> morceau complet (session en cours)

export async function listSongs() {
  const list = [...memory.values()].map(meta);
  if (store.user) {
    try {
      const res = await fetch("api/songs", { cache: "no-store" });
      if (res.ok) for (const m of await res.json()) if (!memory.has(m.id)) list.push(m);
    } catch (e) {}
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function getSong(id) {
  if (!id) return null;
  if (memory.has(id)) return memory.get(id);
  if (!store.user) return null;
  try {
    const res = await fetch("api/songs/" + encodeURIComponent(id), { cache: "no-store" });
    if (!res.ok) return null;
    const song = await res.json();
    memory.set(id, song);
    return song;
  } catch (e) { return null; }
}

export async function saveSong(song) {
  memory.set(song.id, song);
  if (!store.user) return;
  const res = await fetch("api/songs/" + encodeURIComponent(song.id), {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song),
  });
  if (!res.ok) throw new Error("Le morceau n'a pas pu être enregistré (fichier trop gros ?).");
}

export async function deleteSong(id) {
  memory.delete(id);
  if (store.user) await fetch("api/songs/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
}

function meta(s) { return { id: s.id, name: s.name, notes: s.parts.reduce((n, p) => n + p.count, 0) }; }
