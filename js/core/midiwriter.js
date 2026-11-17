// Écriture d'un fichier MIDI standard (format 1) à partir d'un "morceau" (voir song.js) :
// une piste de méta-événements (tempo, mesure, armure) + une piste par partie.

function vlq(n) {
  const bytes = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  return bytes;
}

function metaEvent(dt, type, data) {
  return [...vlq(dt), 0xff, type, ...vlq(data.length), ...data];
}

function strBytes(s) {
  return [...new TextEncoder().encode(s)];
}

function trackChunk(events) {
  const body = events.flat();
  const len = body.length;
  return [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...body,
  ];
}

function metaTrack(song) {
  const ts = song.timeSigs[0] || { num: 4, den: 4 };
  const uspq = song.tempos[0]?.uspq ?? 500000;
  const events = [
    metaEvent(0, 0x51, [(uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff]),
    metaEvent(0, 0x58, [ts.num, Math.round(Math.log2(ts.den)), 24, 8]),
  ];
  if (song.keySig) events.push(metaEvent(0, 0x59, [song.keySig.sf << 24 >> 24, song.keySig.minor ? 1 : 0]));
  events.push(metaEvent(0, 0x2f, []));
  return trackChunk(events);
}

function partTrack(part) {
  const evs = [];
  for (const [midi, tick, dur] of part.notes) {
    evs.push({ tick, bytes: [0x90, midi, 90] });
    evs.push({ tick: tick + Math.max(1, dur), bytes: [0x80, midi, 0] });
  }
  evs.sort((a, b) => a.tick - b.tick);
  const events = [metaEvent(0, 0x03, strBytes(part.name || ""))];
  let last = 0;
  for (const e of evs) { events.push([...vlq(e.tick - last), ...e.bytes]); last = e.tick; }
  events.push(metaEvent(0, 0x2f, []));
  return trackChunk(events);
}

// Renvoie les octets (Uint8Array) d'un fichier .mid à partir d'un morceau (voir song.js : songFromMidi,
// ou un document créé dans l'éditeur). N'écrit que le premier tempo / la première mesure / armure
// (suffisant pour une partition créée dans l'éditeur, qui n'en a qu'une).
export function songToMidiBytes(song) {
  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, // "MThd", longueur 6
    0, 1,                                // format 1
    (song.parts.length + 1) >> 8, (song.parts.length + 1) & 0xff,
    (song.ppq >> 8) & 0xff, song.ppq & 0xff,
  ];
  const bytes = [...header, ...metaTrack(song), ...song.parts.flatMap(partTrack)];
  return new Uint8Array(bytes);
}

export function downloadMidi(song) {
  const blob = new Blob([songToMidiBytes(song)], { type: "audio/midi" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (song.name || "partition").replace(/[\\/:*?"<>|]+/g, "_") + ".mid";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
