// Add / edit an admin user. Routes:
//   #/admin-users/new        -> blank form, POSTs
//   #/admin-users/:id/edit   -> pre-filled form, PUTs
//
// Adapted from aph2-diary's admin-users-form.js. Differences:
//   - Role flags are ours (super_user, manage_users, manage_groups, view_reports)
//   - fob_number field added so admins can also use the door
//   - No linked-diary-user picker (we don't have a search-users endpoint and
//     the linked user is rarely useful here; can add later)
//
// The password is set via a separate prompt from the list view - never mixed
// into this form so we can't accidentally overwrite a password with blank
// when editing flags.

import { LightDomElement, html } from "../base.js";
import { apiGet, apiPost, apiPut } from "../api.js";
import { go } from "../router.js";
import { fieldRow } from "./form-field.js";
import "./error-banner.js";

const TEXT_INPUT =
  "w-full border border-gray-300 rounded px-2 py-1.5 focus:border-slate-500 focus:outline-none";

const BLANK = {
  username: "",
  fob_number: "",
  super_user: 0,
  manage_users: 0,
  manage_groups: 0,
  view_reports: 0,
};

// One checkbox row. Light-DOM Lit: use .checked so Lit writes the property
// rather than the attribute (the attribute only reflects the INITIAL state).
function checkboxRow(name, label, checked) {
  return html`
    <label class="flex items-center gap-2 text-sm">
      <input
        name=${name} type="checkbox" value="1"
        .checked=${!!checked}
        class="w-4 h-4 rounded border-gray-300"
      >
      <span>${label}</span>
    </label>
  `;
}

class AdminUsersForm extends LightDomElement {
  static properties = {
    adminUserId: { type: Number },
    _row:     { state: true },
    _error:   { state: true },
    _loading: { state: true },
    _busy:    { state: true },
  };

  constructor() {
    super();
    this.adminUserId = null;
    this._row = { ...BLANK };
    this._error = "";
    this._loading = false;
    this._busy = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    if (this.adminUserId != null) {
      this._loading = true;
      try {
        const data = await apiGet(`/admin-users/${this.adminUserId}`);
        this._row = data.admin_user;
      } catch (e) {
        this._error = e.message;
      } finally {
        this._loading = false;
      }
    }
  }

  async _submit(ev) {
    ev.preventDefault();
    this._error = "";
    this._busy = true;

    const fd = new FormData(ev.target);
    const check = (name) => fd.get(name) === "1" ? 1 : 0;

    const fobRaw = (fd.get("fob_number") ?? "").toString().trim();
    const payload = {
      username:      (fd.get("username") ?? "").toString().trim(),
      fob_number:    fobRaw === "" ? null : fobRaw,
      super_user:    check("super_user"),
      manage_users:  check("manage_users"),
      manage_groups: check("manage_groups"),
      view_reports:  check("view_reports"),
    };

    try {
      if (this.adminUserId == null) {
        await apiPost("/admin-users", payload);
      } else {
        await apiPut(`/admin-users/${this.adminUserId}`, payload);
      }
      go("/admin-users");
    } catch (e) {
      this._error = e.message;
    } finally {
      this._busy = false;
    }
  }

  _cancel() { go("/admin-users"); }

  render() {
    if (this._loading) {
      return html`<p class="text-sm text-gray-500 py-4">Loading…</p>`;
    }
    const r = this._row;
    const isNew = this.adminUserId == null;

    return html`
      <section class="max-w-lg space-y-3">
        <h1 class="text-lg font-semibold">
          ${isNew ? "Add admin user" : `Edit ${r.username || "admin"}`}
        </h1>

        <error-banner .message=${this._error}></error-banner>

        <form @submit=${(ev) => this._submit(ev)} class="space-y-4">
          ${fieldRow({
            label: "Username",
            help:  isNew ? "Usually an email address. Must be unique." : "",
            input: html`
              <input
                name="username" required autocomplete="off" autofocus
                .value=${r.username ?? ""}
                class=${TEXT_INPUT}
              >
            `,
          })}

          ${fieldRow({
            label: "Fob (optional)",
            help:  "Lets the admin also use the door. Tap on the USB enrollment reader to fill.",
            input: html`
              <input
                name="fob_number" autocomplete="off"
                inputmode="numeric"
                .value=${r.fob_number ?? ""}
                class=${`${TEXT_INPUT} font-mono`}
              >
            `,
          })}

          <fieldset class="border border-gray-200 rounded p-3 space-y-2">
            <legend class="text-xs uppercase tracking-wide text-gray-500 px-1">Role</legend>
            ${checkboxRow("super_user",    "Super user (full control, can manage other admins)", r.super_user)}
            ${checkboxRow("manage_users",  "Manage door users", r.manage_users)}
            ${checkboxRow("manage_groups", "Manage groups",     r.manage_groups)}
            ${checkboxRow("view_reports",  "View access log",   r.view_reports)}
          </fieldset>

          ${isNew
            ? html`<p class="text-xs text-gray-500">
                After saving, set a password via the Password button on the admin-users list.
                Admins with no password cannot sign in.
              </p>`
            : ""}

          <div class="flex gap-2 pt-2">
            <button
              type="submit"
              class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-60"
              ?disabled=${this._busy}
            >${this._busy ? "Saving…" : isNew ? "Create" : "Save changes"}</button>
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
              @click=${() => this._cancel()}
            >Cancel</button>
          </div>
        </form>
      </section>
    `;
  }
}
customElements.define("admin-users-form", AdminUsersForm);
