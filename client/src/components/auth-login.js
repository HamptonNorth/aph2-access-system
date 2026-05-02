// Login screen shown when no session is active. On success it dispatches
// aph-auth-changed, which main.js listens for to re-boot the app.

import { LightDomElement, html } from "../base.js";
import { apiPost } from "../api.js";
import { checkSession } from "../store.js";
import "./error-banner.js";

class AuthLogin extends LightDomElement {
  static properties = {
    _error: { state: true },
    _busy:  { state: true },
  };

  constructor() {
    super();
    this._error = "";
    this._busy = false;
  }

  async _submit(ev) {
    ev.preventDefault();
    this._error = "";
    this._busy = true;

    const form = new FormData(ev.target);
    try {
      await apiPost("/auth/login", {
        username: form.get("username"),
        password: form.get("password"),
      });
      await checkSession();
      window.dispatchEvent(new Event("aph-auth-changed"));
    } catch (e) {
      this._error = e.message || "Could not sign in.";
    } finally {
      this._busy = false;
    }
  }

  render() {
    return html`
      <div class="min-h-screen flex items-center justify-center p-4">
        <form
          @submit=${(ev) => this._submit(ev)}
          class="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4"
        >
          <h1 class="text-lg font-semibold">Sign in to APH2 Access</h1>
          <error-banner .message=${this._error}></error-banner>

          <label class="block text-sm">
            <span class="text-gray-700">Username</span>
            <input
              name="username"
              required autofocus autocomplete="username"
              class="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 focus:border-slate-500 focus:outline-none"
            >
          </label>

          <label class="block text-sm">
            <span class="text-gray-700">Password</span>
            <input
              name="password" type="password" required autocomplete="current-password"
              class="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 focus:border-slate-500 focus:outline-none"
            >
          </label>

          <button
            type="submit"
            class="w-full bg-slate-800 hover:bg-slate-700 text-white rounded px-3 py-2 disabled:opacity-60"
            ?disabled=${this._busy}
          >${this._busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
    `;
  }
}
customElements.define("auth-login", AuthLogin);
