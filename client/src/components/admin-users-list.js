// Admin-users list at #/admin-users. Super-user only (server enforces; this
// view just mirrors). Actions per row: Edit, Set password, Delete (hidden
// for self - cannot delete yourself).
//
// On 409 has_history we offer Deactivate as a fallback (mirrors aph2-diary).

import { LightDomElement, html } from "../base.js";
import { apiGet, apiPost, apiPut, apiDelete } from "../api.js";
import { go } from "../router.js";
import { getAdmin } from "../store.js";
import "./data-table.js";
import "./error-banner.js";
import "./confirm-dialog.js";

const COLUMNS = [
  { key: "username",   label: "Username" },
  { key: "fob_number", label: "Fob" },
  {
    key: "super_user",
    label: "Super",
    render: (row) => row.super_user ? "Yes" : "",
  },
  {
    key: "roles",
    label: "Roles",
    render: (row) => {
      const r = [];
      if (row.manage_users)  r.push("users");
      if (row.manage_groups) r.push("groups");
      if (row.view_reports)  r.push("reports");
      return r.join(", ") || html`<span class="text-gray-400">—</span>`;
    },
  },
  {
    key: "has_password",
    label: "Password",
    render: (row) => row.has_password
      ? html`<span class="text-green-700">Set</span>`
      : html`<span class="text-red-700">Not set</span>`,
  },
];

class AdminUsersList extends LightDomElement {
  static properties = {
    _rows:    { state: true },
    _error:   { state: true },
    _loading: { state: true },
  };

  constructor() {
    super();
    this._rows = [];
    this._error = "";
    this._loading = true;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._load();
  }

  async _load() {
    this._loading = true;
    this._error = "";
    try {
      const data = await apiGet("/admin-users");
      this._rows = data.admin_users;
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  _edit(row) { go(`/admin-users/${row.id}/edit`); }

  _setPassword(row) {
    const pw = prompt(`New password for ${row.username}?`, "");
    if (pw === null) return;
    if (!pw) {
      this._error = "password cannot be empty";
      return;
    }
    apiPut(`/admin-users/${row.id}/password`, { password: pw })
      .then(() => this._load())
      .catch((e) => { this._error = e.message; });
  }

  _delete(row) {
    const dlg = document.createElement("confirm-dialog");
    dlg.message = `Delete admin "${row.username}"? This cannot be undone.`;
    dlg.confirmText = "Delete";
    dlg.addEventListener("confirm", async () => {
      try {
        await apiDelete(`/admin-users/${row.id}`);
        await this._load();
      } catch (e) {
        if (e.status === 409 && e.body?.code === "has_history") {
          this._offerDeactivate(row);
          return;
        }
        this._error = e.message;
      }
    });
    document.body.appendChild(dlg);
  }

  _offerDeactivate(row) {
    const dlg = document.createElement("confirm-dialog");
    dlg.message =
      `"${row.username}" has historical audit records and can't be removed entirely. ` +
      `Deactivate instead? Their password, every role flag, fob, and linked user ` +
      `will be cleared so they can no longer sign in.`;
    dlg.confirmText = "Deactivate";
    dlg.addEventListener("confirm", async () => {
      try {
        await apiPost(`/admin-users/${row.id}/deactivate`);
        await this._load();
      } catch (e) {
        this._error = e.message;
      }
    });
    document.body.appendChild(dlg);
  }

  render() {
    const me = getAdmin();

    const actions = (row) => html`
      <button
        type="button"
        class="text-slate-700 hover:underline mr-3"
        @click=${(ev) => { ev.stopPropagation(); this._edit(row); }}
      >Edit</button>
      <button
        type="button"
        class="text-slate-700 hover:underline mr-3"
        @click=${(ev) => { ev.stopPropagation(); this._setPassword(row); }}
      >Password</button>
      ${row.id === me?.id
        ? html`<span class="text-gray-300 cursor-not-allowed" title="Cannot delete your own account">Delete</span>`
        : html`<button
            type="button"
            class="text-red-700 hover:underline"
            @click=${(ev) => { ev.stopPropagation(); this._delete(row); }}
          >Delete</button>`}
    `;

    return html`
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-lg font-semibold">Admin users</h1>
          <a
            href="#/admin-users/new"
            class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-sm"
          >Add admin</a>
        </div>

        <error-banner .message=${this._error}></error-banner>

        ${this._loading
          ? html`<p class="text-sm text-gray-500 py-4">Loading…</p>`
          : html`
              <data-table
                .columns=${COLUMNS}
                .rows=${this._rows}
                .actions=${actions}
                empty="No admin users."
              ></data-table>
            `}
      </section>
    `;
  }
}
customElements.define("admin-users-list", AdminUsersList);
