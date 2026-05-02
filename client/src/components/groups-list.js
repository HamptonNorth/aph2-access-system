// Groups list at #/groups. manage_groups (or super_user) sees it. Per-row
// actions: Edit, Delete (delete fails 409 if any user references the group).

import { LightDomElement, html } from "../base.js";
import { apiGet, apiDelete } from "../api.js";
import { go } from "../router.js";
import "./data-table.js";
import "./error-banner.js";
import "./confirm-dialog.js";

const COLUMNS = [
  { key: "name",        label: "Name" },
  { key: "description", label: "Description" },
  { key: "user_count",  label: "Users", align: "right" },
];

class GroupsList extends LightDomElement {
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
      const data = await apiGet("/groups");
      this._rows = data.groups;
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  _edit(row) { go(`/groups/${row.id}/edit`); }

  _delete(row) {
    const dlg = document.createElement("confirm-dialog");
    dlg.message = `Delete group "${row.name}"? This cannot be undone.`;
    dlg.confirmText = "Delete";
    dlg.addEventListener("confirm", async () => {
      try {
        await apiDelete(`/groups/${row.id}`);
        await this._load();
      } catch (e) {
        if (e.status === 409 && e.body?.code === "has_users") {
          this._error =
            `"${row.name}" still has ${row.user_count} user(s). Reassign them ` +
            `to another group first, then try again.`;
          return;
        }
        this._error = e.message;
      }
    });
    document.body.appendChild(dlg);
  }

  render() {
    const actions = (row) => html`
      <button
        type="button"
        class="text-slate-700 hover:underline mr-3"
        @click=${(ev) => { ev.stopPropagation(); this._edit(row); }}
      >Edit</button>
      <button
        type="button"
        class="text-red-700 hover:underline"
        @click=${(ev) => { ev.stopPropagation(); this._delete(row); }}
      >Delete</button>
    `;

    return html`
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-lg font-semibold">Groups</h1>
          <a
            href="#/groups/new"
            class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-sm"
          >Add group</a>
        </div>

        <error-banner .message=${this._error}></error-banner>

        ${this._loading
          ? html`<p class="text-sm text-gray-500 py-4">Loading…</p>`
          : html`
              <data-table
                .columns=${COLUMNS}
                .rows=${this._rows}
                .actions=${actions}
                empty="No groups yet."
              ></data-table>
            `}
      </section>
    `;
  }
}
customElements.define("groups-list", GroupsList);
