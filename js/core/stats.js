// Statistiques : enregistre chaque réponse et calcule les progrès.
//
// Une réponse (un "événement") = une colonne de l'exercice terminée :
//   { t: horodatage (ms), ex: id de l'exercice, p: id du préréglage ("" si aucun),
//     ok: 1 si réussie du premier coup sinon 0, ms: temps de réponse, n: nombre de notes }
// Gardées dans le navigateur (localStorage).

const KEY = "spt:stats";
const SESSION_GAP = 30 * 60 * 1000;   // plus de 30 min sans jouer = nouvelle séance
const MAX_MS = 30000;                 // au-delà, on considère une pause

let events = [];

export function loadStats() {
  try { events = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { events = []; }
  return events;
}

export function record(ev) {
  const e = { ...ev, ms: Math.min(MAX_MS, Math.round(ev.ms)) };
  events.push(e);
  try { localStorage.setItem(KEY, JSON.stringify(events)); } catch (e) {}
}

export function flush() {} // plus rien à envoyer : record() enregistre déjà tout de suite

export function clearStats() {
  events = [];
  try { localStorage.removeItem(KEY); } catch (e) {}
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
