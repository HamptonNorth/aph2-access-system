// Home view shown at "/" once signed in. Quick links to the most common
// tasks; each one is hidden for admins who don't have the relevant role.

import { LightDomElement, html } from "../base.js";
import { getAdmin, getClientConfig } from "../store.js";

const TILE =
  "block bg-white border border-gray-200 rounded p-4 hover:bg-slate-50 hover:border-slate-300 transition";

class HomeView extends LightDomElement {
  render() {
    const admin = getAdmin();
    const cfg = getClientConfig();
    const can = (flag) => admin?.super_user || admin?.[flag];

    return html`
      <section class="space-y-6">
        <header>
          <h1 class="text-xl font-semibold">Welcome, ${admin?.username ?? ""}</h1>
          <p class="text-sm text-gray-500">${cfg?.app?.name ?? "APH2 Access"} ${cfg?.app?.version ? `· v${cfg.app.version}` : ""}</p>
        </header>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${can("manage_users") ? html`
            <a href="#/users" class=${TILE}>
              <div class="font-medium">Users</div>
              <div class="text-xs text-gray-500">Add, amend, block, delete door users.</div>
            </a>
          ` : ""}
          ${can("manage_groups") ? html`
            <a href="#/groups" class=${TILE}>
              <div class="font-medium">Groups</div>
              <div class="text-xs text-gray-500">Manage group labels (Trustees, Bowls Club, …).</div>
            </a>
          ` : ""}
          ${can("view_reports") ? html`
            <a href="#/access-log" class=${TILE}>
              <div class="font-medium">Access log</div>
              <div class="text-xs text-gray-500">Filter swipes by date, user, group, fob, outcome.</div>
            </a>
          ` : ""}
          ${admin?.super_user ? html`
            <a href="#/admin-users" class=${TILE}>
              <div class="font-medium">Admin users</div>
              <div class="text-xs text-gray-500">Web users with role flags and passwords.</div>
            </a>
            <a href="#/controller" class=${TILE}>
              <div class="font-medium">Controller status</div>
              <div class="text-xs text-gray-500">UHPPOTE board sync queue.</div>
            </a>
          ` : ""}
        </div>
      </section>
    `;
  }
}
customElements.define("home-view", HomeView);
