// Add / edit a door user. Routes:
//   #/users/new        -> blank form, POSTs
//   #/users/:id/edit   -> pre-filled form, PUTs
//
// USB EM4100 enrollment: most readers act as a HID keyboard - they "type"
// the fob number followed by Enter into the focused input. We autofocus the
// fob input on the new-user form, so tapping the fob types the number and
// hitting Enter submits the form. The first_name / surname inputs are filled
// in by hand before the fob is tapped.

import { LightDomElement, html } from "../base.js";
import { apiGet, apiPost, apiPut } from "../api.js";
import { go } from "../router.js";
import { fieldRow } from "./form-field.js";
import "./error-banner.js";

const TEXT_INPUT =
  "w-full border border-gray-300 rounded px-2 py-1.5 focus:border-slate-500 focus:outline-none";

const BLANK = {
  first_name: "",
  surname:    "",
  fob_number: "",
  group_id:   null,
};

class UsersForm extends LightDomElement {
  static properties = {
    userId:   { type: Number },
    _row:     { state: true },
    _groups:  { state: true },
    _error:   { state: true },
    _loading: { state: true },
    _busy:    { state: true },
  };

  constructor() {
    super();
    this.userId = null;
    this._row = { ...BLANK };
    this._groups = [];
    this._error = "";
    this._loading = false;
    this._busy = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    this._loading = true;
    try {
      // Groups for the dropdown. Both new and edit forms need them.
      const g = await apiGet("/groups");
      this._groups = g.groups ?? [];

      if (this.userId != null) {
        const data = await apiGet(`/users/${this.userId}`);
        this._row = data.user;
      }
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  async _submit(ev) {
    ev.preventDefault();
    this._error = "";
    this._busy = true;

    const fd = new FormData(ev.target);
    const groupRaw = fd.get("group_id");
    const payload = {
      first_name: (fd.get("first_name") ?? "").toString().trim(),
      surname:    (fd.get("surname")    ?? "").toString().trim(),
      fob_number: (fd.get("fob_number") ?? "").toString().trim(),
      group_id:   groupRaw === "" || groupRaw == null ? null : Number(groupRaw),
    };

    try {
      if (this.userId == null) {
        await apiPost("/users", payload);
      } else {
        // Amend cannot clear the fob via PUT - if you want that, soft-delete.
        await apiPut(`/users/${this.userId}`, payload);
      }
      go("/users");
    } catch (e) {
      this._error = e.message;
    } finally {
      this._busy = false;
    }
  }

  _cancel() { go("/users"); }

  render() {
    if (this._loading) {
      return html`<p class="text-sm text-gray-500 py-4">Loading…</p>`;
    }
    const r = this._row;
    const isNew = this.userId == null;
    const titleName = `${r.first_name ?? ""} ${r.surname ?? ""}`.trim();

    return html`
      <section class="max-w-lg space-y-3">
        <h1 class="text-lg font-semibold">
          ${isNew ? "Add door user" : `Edit ${titleName || "user"}`}
        </h1>

        <error-banner .message=${this._error}></error-banner>

        <form @submit=${(ev) => this._submit(ev)} class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${fieldRow({
              label: "First name",
              input: html`
                <input
                  name="first_name" required autocomplete="off"
                  ?autofocus=${isNew}
                  .value=${r.first_name ?? ""}
                  class=${TEXT_INPUT}
                >
              `,
            })}
            ${fieldRow({
              label: "Surname",
              input: html`
                <input
                  name="surname" required autocomplete="off"
                  .value=${r.surname ?? ""}
                  class=${TEXT_INPUT}
                >
              `,
            })}
          </div>

          ${fieldRow({
            label: "Fob number",
            help:  isNew
              ? "Tap the fob on the USB enrollment reader after filling in the names - it types the 10-digit number and Enter submits the form."
              : "Changing this re-syncs the controller (delete old + add new).",
            input: html`
              <input
                name="fob_number" required autocomplete="off"
                inputmode="numeric"
                .value=${r.fob_number ?? ""}
                class=${`${TEXT_INPUT} font-mono`}
              >
            `,
          })}

          ${fieldRow({
            label: "Group",
            input: html`
              <select name="group_id" class=${TEXT_INPUT}>
                <option value="">(none)</option>
                ${this._groups.map(
                  (g) => html`
                    <option value=${g.id} ?selected=${g.id === r.group_id}>
                      ${g.name}
                    </option>
                  `
                )}
              </select>
            `,
          })}

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
customElements.define("users-form", UsersForm);
