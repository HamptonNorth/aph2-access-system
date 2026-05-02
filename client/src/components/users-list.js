// Door-users list at #/users. manage_users (or super_user) can edit; the
// "Show deleted" toggle reveals soft-deleted rows for audit / fob-reissue.
//
// Per row actions: Edit, Block / Unblock, Delete (soft).
//
// List is sorted server-side by surname, then first_name (the conventional
// "people list" ordering).

import { LightDomElement, html } from "../base.js";
import { apiGet, apiPost, apiDelete } from "../api.js";
import { go } from "../router.js";
import "./data-table.js";
import "./error-banner.js";
import "./confirm-dialog.js";

const COLUMNS = [
  { key: "surname",     label: "Surname" },
  { key: "first_name",  label: "First name" },
  { key: "fob_number",  label: "Fob" },
  { key: "group_name",  label: "Group" },
  {
    key: "blocked",
    label: "Status",
    render: (row) => {
      if (row.deleted_at) {
        return html`<span class="text-gray-500">deleted</span>`;
      }
      if (row.blocked) {
        return html`<span class="text-red-700"
          title=${row.blocked_reason ?? ""}
        >blocked</span>`;
      }
      return html`<span class="text-green-700">active</span>`;
    },
  },
];

class UsersList extends LightDomElement {
  static properties = {
    _rows:     { state: true },
    _error:    { state: true },
    _loading:  { state: true },
    _showDel:  { state: true },
  };

  constructor() {
    super();
    this._rows = [];
    this._error = "";
    this._loading = true;
    this._showDel = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._load();
  }

  async _load() {
    this._loading = true;
    this._error = "";
    try {
      const path = this._showDel ? "/users?include_deleted=1" : "/users";
      const data = await apiGet(path);
      this._rows = data.users;
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  _toggleShowDeleted() {
    this._showDel = !this._showDel;
    this._load();
  }

  _edit(row) {
    go(`/users/${row.id}/edit`);
  }

  _block(row) {
    const dlg = document.createElement("confirm-dialog");
    dlg.message =
      `Block "${row.name}" (fob ${row.fob_number})? They'll be denied at the door. ` +
      `You'll be asked for a reason next.`;
    dlg.confirmText = "Block";
    dlg.addEventListener("confirm", () => this._promptReason(row));
    document.body.appendChild(dlg);
  }

  _promptReason(row) {
    const reason = prompt(`Reason for blocking ${row.name}?`, "");
    if (reason === null) return;
    if (!reason.trim()) {
      this._error = "block reason cannot be empty";
      return;
    }
    apiPost(`/users/${row.id}/block`, { reason: reason.trim() })
      .then(() => this._load())
      .catch((e) => { this._error = e.message; });
  }

  _unblock(row) {
    apiPost(`/users/${row.id}/unblock`)
      .then(() => this._load())
      .catch((e) => { this._error = e.message; });
  }

  _delete(row) {
    const dlg = document.createElement("confirm-dialog");
    dlg.message =
      `Delete "${row.name}"? Their fob (${row.fob_number}) will be released so it ` +
      `can be reissued. Historical access-log rows stay attached.`;
    dlg.confirmText = "Delete";
    dlg.addEventListener("confirm", async () => {
      try {
        await apiDelete(`/users/${row.id}`);
        await this._load();
      } catch (e) {
        this._error = e.message;
      }
    });
    document.body.appendChild(dlg);
  }

  render() {
    // Action buttons: padded enough to be tappable on mobile (≥ 28 px tall),
    // colour-coded by intent, visual feedback on hover via background tint.
    const actions = (row) => {
      if (row.deleted_at) {
        return html`<span class="text-gray-400 text-sm">read only</span>`;
      }
      return html`
        <div class="inline-flex flex-wrap gap-1 items-center">
          <button type="button"
            class="px-2 py-1 rounded text-slate-700 hover:bg-slate-100"
            @click=${(ev) => { ev.stopPropagation(); this._edit(row); }}
          >Edit</button>
          ${row.blocked
            ? html`<button type="button"
                class="px-2 py-1 rounded text-green-700 hover:bg-green-50"
                @click=${(ev) => { ev.stopPropagation(); this._unblock(row); }}
              >Unblock</button>`
            : html`<button type="button"
                class="px-2 py-1 rounded text-amber-700 hover:bg-amber-50"
                @click=${(ev) => { ev.stopPropagation(); this._block(row); }}
              >Block</button>`}
          <button type="button"
            class="px-2 py-1 rounded text-red-700 hover:bg-red-50"
            @click=${(ev) => { ev.stopPropagation(); this._delete(row); }}
          >Delete</button>
        </div>
      `;
    };

    return html`
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-lg font-semibold">Door users</h1>
          <a
            href="#/users/new"
            class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-sm"
          >Add user</a>
        </div>

        <error-banner .message=${this._error}></error-banner>

        <label class="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox"
            .checked=${this._showDel}
            @change=${() => this._toggleShowDeleted()}
            class="w-4 h-4 rounded border-gray-300"
          >
          Show deleted (read-only)
        </label>

        ${this._loading
          ? html`<p class="text-sm text-gray-500 py-4">Loading…</p>`
          : html`
              <data-table
                .columns=${COLUMNS}
                .rows=${this._rows}
                .actions=${actions}
                pageSize="50"
                empty="No users yet."
              ></data-table>
            `}
      </section>
    `;
  }
}
customElements.define("users-list", UsersList);
