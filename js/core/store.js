// Compte et stockage.
// Rien n'est enregistré dans le navigateur (seul un cookie de connexion existe).
// - Connecté : réglages, préréglages et statistiques sont gardés sur le serveur (data/users/<pseudo>/).
// - Pas connecté : on joue librement, mais rien n'est gardé après fermeture de la page.

export const store = {
  user: null,                              // pseudo du compte connecté, ou null
  state: { settings: {}, presets: null },

  async init() {
    // nettoyage des anciennes versions qui gardaient tout dans le navigateur
    try {
      ["lecture-notes:v2", "sunshi-piano-tool:state", "sunshi-piano-tool:stats"].forEach((k) => localStorage.removeItem(k));
    } catch (e) {}

    try {
      const me = await (await fetch("api/me", { cache: "no-store" })).json();
      this.user = me.user || null;
    } catch (e) { this.user = null; }

    if (this.user) {
      try {
        const res = await fetch("api/state", { cache: "no-store" });
        if (res.ok) this.state = await res.json();
      } catch (e) {}
    }
    this.state = this.state || {};
    this.state.settings = this.state.settings || {};
    return this.state;
  },

  save() {
    if (!this.user) return; // pas de compte : rien n'est gardé
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      fetch("api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.state),
      }).catch(() => {});
    }, 300);
  },

  async login(username, password, create = false) {
    const res = await fetch(create ? "api/register" : "api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erreur de connexion.");
    return data.user;
  },

  async logout() {
    await fetch("api/logout", { method: "POST" }).catch(() => {});
  },
};
