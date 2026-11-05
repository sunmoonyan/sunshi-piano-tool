// Réglages : un magasin (sauvegardé dans le navigateur) + un générateur de formulaire.
//
// Un réglage se décrit par un objet "champ" :
//   { key, label, type, help?, options?, when? }
// Types disponibles :
//   "toggle"    : case à cocher (booléen)
//   "choice"    : boutons segmentés   options: [{ value, label }]
//   "select"    : liste déroulante    options: [{ value, label }]
//   "number"    : nombre              min, max, step
//   "swatch"    : pastilles de couleur  options: [{ value, label, light, dark }]
//   "noteRange" : note min / note max (valeur { min, max } en indices diatoniques)
//                 min, max : bornes proposées ; perClef: true → une fourchette par clé
// `when(settings)` (facultatif) : n'affiche le champ que si la fonction renvoie true.

import { diatonicLabel } from "./music.js";

import { store } from "./store.js";

// Réglages qui ne font pas partie des préréglages d'exercice (apparence, enregistrement des stats)
const APPEARANCE = ["accent", "theme", "statsOn"];

export class Settings {
  // `saved` : réglages enregistrés (voir store.js)
  constructor(defaults, saved = {}) {
    this.defaults = structuredClone(defaults);
    this.values = structuredClone(defaults);
    this.listeners = [];
    deepMerge(this.values, saved || {});
  }
  get(key) { return getPath(this.values, key); }
  set(key, value) {
    setPath(this.values, key, value);
    this.persist();
    this.listeners.forEach((fn) => fn(key, value));
  }
  persist() {
    store.state.settings = this.values;
    store.save();
  }
  onChange(fn) { this.listeners.push(fn); }

  // Copie des réglages d'exercice (sans l'apparence), pour un préréglage
  snapshot() {
    const copy = structuredClone(this.values);
    APPEARANCE.forEach((k) => delete copy[k]);
    return copy;
  }
  // Charge un préréglage (l'apparence actuelle est conservée)
  apply(values) {
    const next = structuredClone(this.defaults);
    deepMerge(next, structuredClone(values));
    APPEARANCE.forEach((k) => { next[k] = this.values[k]; });
    this.values = next;
    this.persist();
    this.listeners.forEach((fn) => fn("*"));
  }
  // Vrai si les réglages actuels correspondent à `values`
  matches(values) {
    const a = structuredClone(this.defaults);
    deepMerge(a, structuredClone(values));
    APPEARANCE.forEach((k) => delete a[k]);
    return stableJSON(a) === stableJSON(this.snapshot());
  }
}

function stableJSON(v) {
  if (Array.isArray(v)) return "[" + v.map(stableJSON).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableJSON(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] && typeof o[k] === "object" ? o[k] : {}), obj);
  target[last] = value;
}
function deepMerge(target, src) {
  for (const k in src) {
    if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k]) && target[k] && typeof target[k] === "object") {
      deepMerge(target[k], src[k]);
    } else {
      target[k] = src[k];
    }
  }
}

let uid = 0;

// Construit le formulaire d'une liste de champs dans `container`
export function renderFields(container, fields, settings, onRerender) {
  container.innerHTML = "";
  for (const field of fields) {
    if (field.when && !field.when(settings)) continue;
    const row = document.createElement("div");
    row.className = "field field-" + field.type;
    const id = "f" + ++uid;
    const label = document.createElement(field.type === "toggle" ? "label" : "div");
    label.className = "field-label";

    const build = RENDERERS[field.type];
    if (!build) throw new Error("Type de réglage inconnu : " + field.type);
    const control = build(field, settings, id, onRerender);

    if (field.type === "toggle") {
      label.htmlFor = id;
      label.append(control, document.createTextNode(" " + field.label));
      row.append(label);
    } else {
      label.textContent = field.label;
      label.id = id + "-label";
      row.append(label, control);
    }
    if (field.help) {
      const help = document.createElement("p");
      help.className = "field-help";
      help.textContent = field.help;
      row.append(help);
    }
    container.append(row);
  }
}

const RENDERERS = {
  toggle(field, settings, id) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = !!settings.get(field.key);
    input.addEventListener("change", () => settings.set(field.key, input.checked));
    return input;
  },

  choice(field, settings, id, rerender) {
    const group = document.createElement("div");
    group.className = "seg";
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", id + "-label");
    const current = settings.get(field.key);
    for (const opt of field.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = opt.label;
      b.setAttribute("aria-pressed", String(opt.value === current));
      b.addEventListener("click", () => {
        settings.set(field.key, opt.value);
        group.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        rerender && rerender();
      });
      group.append(b);
    }
    return group;
  },

  swatch(field, settings, id) {
    const group = document.createElement("div");
    group.className = "swatches";
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", id + "-label");
    const current = settings.get(field.key);
    for (const opt of field.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = opt.label;
      b.setAttribute("aria-label", opt.label);
      b.style.setProperty("--sw-l", opt.light);
      b.style.setProperty("--sw-d", opt.dark);
      b.setAttribute("aria-pressed", String(opt.value === current));
      b.addEventListener("click", () => {
        settings.set(field.key, opt.value);
        group.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      group.append(b);
    }
    return group;
  },

  select(field, settings, id, rerender) {
    const sel = document.createElement("select");
    sel.id = id;
    for (const opt of field.options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      sel.append(o);
    }
    sel.value = settings.get(field.key);
    sel.addEventListener("change", () => { settings.set(field.key, sel.value); rerender && rerender(); });
    return sel;
  },

  number(field, settings, id) {
    const input = document.createElement("input");
    input.type = "number";
    input.id = id;
    Object.assign(input, { min: field.min, max: field.max, step: field.step || 1 });
    input.value = settings.get(field.key);
    input.addEventListener("change", () => {
      const v = Math.min(field.max, Math.max(field.min, Number(input.value) || field.min));
      input.value = v;
      settings.set(field.key, v);
    });
    return input;
  },

  noteRange(field, settings, id) {
    const key = () => (field.perClef ? field.key + "." + settings.get("clef") : field.key);
    const wrap = document.createElement("div");
    wrap.className = "range-row";
    const value = settings.get(key()) || { min: field.min, max: field.max };

    const make = (which, text) => {
      const lab = document.createElement("label");
      lab.className = "range-part";
      const span = document.createElement("span");
      span.textContent = text;
      const sel = document.createElement("select");
      sel.id = id + "-" + which;
      for (let d = field.min; d <= field.max; d++) {
        const o = document.createElement("option");
        o.value = d;
        o.textContent = diatonicLabel(d);
        sel.append(o);
      }
      sel.value = value[which];
      lab.append(span, sel);
      return { lab, sel };
    };
    const lo = make("min", "De");
    const hi = make("max", "à");
    const update = (changed) => {
      let min = Number(lo.sel.value), max = Number(hi.sel.value);
      if (min > max) {
        if (changed === "min") max = min; else min = max;
        lo.sel.value = min; hi.sel.value = max;
      }
      settings.set(key(), { min, max });
    };
    lo.sel.addEventListener("change", () => update("min"));
    hi.sel.addEventListener("change", () => update("max"));
    wrap.append(lo.lab, hi.lab);
    return wrap;
  },
};
