// Statistiques : enregistre chaque réponse et calcule les progrès.
//
// Une réponse (un "événement") = une colonne de l'exercice terminée :
//   { t: horodatage (ms), ex: id de l'exercice, p: id du préréglage ("" si aucun),
//     ok: 1 si réussie du premier coup sinon 0, ms: temps de réponse, n: nombre de notes }
// Enregistrées sur le serveur, dans le dossier du compte connecté. Sans compte : rien n'est enregistré.

import { store } from "./store.js";

const SESSION_GAP = 30 * 60 * 1000;   // plus de 30 min sans jouer = nouvelle séance
const MAX_MS = 30000;                 // au-delà, on considère une pause

let events = [];
let pending = [];
let flushTimer = null;

export async function loadStats() {
  events = [];
  if (!store.user) return events;
  try {
    const res = await fetch("api/stats", { cache: "no-store" });
    if (res.ok) events = await res.json();
  } catch (e) {}
  return events;
}

export function record(ev) {
  if (!store.user) return;
  const e = { ...ev, ms: Math.min(MAX_MS, Math.round(ev.ms)) };
  events.push(e);
  pending.push(e);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 1500);
}

export function flush() {
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  fetch("api/stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), keepalive: true })
    .catch(() => { pending = batch.concat(pending); });
}

export async function clearStats() {
  events = [];
  pending = [];
  if (store.user) await fetch("api/stats", { method: "DELETE" }).catch(() => {});
}

export const allEvents = () => events;

// Résumé d'une liste de réponses
export function summarize(list) {
  if (!list.length) return { count: 0, rate: null, avgSec: null };
  const ok = list.filter((e) => e.ok).length;
  const times = list.map((e) => e.ms);
  return {
    count: list.length,
    rate: (ok / list.length) * 100,
    avgSec: times.reduce((s, x) => s + x, 0) / times.length / 1000,
  };
}

// Regroupe par séance (pauses de plus de 30 min) : [{ start, end, ...summary }]
export function bySession(list) {
  const sorted = [...list].sort((a, b) => a.t - b.t);
  const sessions = [];
  let cur = null;
  for (const e of sorted) {
    if (!cur || e.t - cur.end > SESSION_GAP) {
      cur = { start: e.t, end: e.t, items: [] };
      sessions.push(cur);
    }
    cur.end = e.t;
    cur.items.push(e);
  }
  return sessions.map((s) => ({ start: s.start, end: s.end, ...summarize(s.items) }));
}
