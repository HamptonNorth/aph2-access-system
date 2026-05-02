// Add / edit a group. Routes:
//   #/groups/new        -> POSTs
//   #/groups/:id/edit   -> PUTs

import { LightDomElement, html } from "../base.js";
import { apiGet, apiPost, apiPut } from "../api.js";
import { go } from "../router.js";
import { fieldRow } from "./form-field.js";
import "./error-banner.js";

const TEXT_INPUT =
  "w-full border border-gray-300 rounded px-2 py-1.5 focus:border-slate-500 focus:outline-none";

const BLANK = { name: "", description: "" };

class GroupsForm extends LightDomElement {
  static properties = {
    groupId:  { type: Number },
    _row:     { state: true },
    _error:   { state: true },
    _loading: { state: true },
    _busy:    { state: true },
  };

  constructor() {
    super();
    this.groupId = null;
    this._row = { ...BLANK };
    this._error = "";
    this._loading = false;
    this._busy = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    if (this.groupId != null) {
      this._loading = true;
      try {
        const data = await apiGet(`/groups/${this.groupId}`);
        this._row = data.group;
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
    const payload = {
      name:        (fd.get("name") ?? "").toString().trim(),
      description: (fd.get("description") ?? "").toString().trim(),
    };

    try {
      if (this.groupId == null) {
        await apiPost("/groups", payload);
      } else {
        await apiPut(`/groups/${this.groupId}`, payload);
      }
      go("/groups");
    } catch (e) {
      this._error = e.message;
    } finally {
      this._busy = false;
    }
  }

  _cancel() { go("/groups"); }

  render() {
    if (this._loading) {
      return html`<p class="text-sm text-gray-500 py-4">Loading…</p>`;
    }
    const r = this._row;
    const isNew = this.groupId == null;

    return html`
      <section class="max-w-lg space-y-3">
        <h1 class="text-lg font-semibold">
          ${isNew ? "Add group" : `Edit ${r.name || "group"}`}
        </h1>

        <error-banner .message=${this._error}></error-banner>

        <form @submit=${(ev) => this._submit(ev)} class="space-y-4">
          ${fieldRow({
            label: "Name",
            help:  "Must be unique.",
            input: html`
              <input
                name="name" required autocomplete="off" autofocus
                .value=${r.name ?? ""}
                class=${TEXT_INPUT}
              >
            `,
          })}

          ${fieldRow({
            label: "Description",
            input: html`
              <textarea
                name="description" rows="2"
                class=${TEXT_INPUT}
              >${r.description ?? ""}</textarea>
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
customElements.define("groups-form", GroupsForm);
