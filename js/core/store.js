// Réglages et préréglages : gardés dans le navigateur (localStorage), par appareil.

const KEY = "spt:state";

export const store = {
  state: { settings: {}, presets: null },

  init() {
    try {
      this.state = JSON.parse(localStorage.getItem(KEY)) || this.state;
    } catch (e) {}
    this.state.settings = this.state.settings || {};
    return this.state;
  },

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {}
    }, 300);
  },
};
