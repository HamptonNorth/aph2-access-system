// Access-log viewer at #/access-log. Filters: date range, group, user, fob,
// outcome. Submitting the form triggers a fresh GET /api/access-log with the
// active filter set; results render in a paginated table.

import { LightDomElement, html } from "../base.js";
import { apiGet } from "../api.js";
import { fieldRow } from "./form-field.js";
import "./data-table.js";
import "./error-banner.js";

const TEXT_INPUT =
  "w-full border border-gray-300 rounded px-2 py-1.5 focus:border-slate-500 focus:outline-none";

const COLUMNS = [
  {
    key: "ts",
    label: "Time",
    render: (r) => formatTs(r.ts),
  },
  { key: "fob_number", label: "Fob" },
  {
    key: "user_name",
    label: "User",
    render: (r) => {
      if (!r.user_name) return html`<span class="text-gray-400">—</span>`;
      const tag = r.user_deleted_at ? html`<span class="text-xs text-gray-500 ml-1">(deleted)</span>` : "";
      return html`<span>${r.user_name}${tag}</span>`;
    },
  },
  { key: "group_name", label: "Group" },
  {
    key: "outcome",
    label: "Outcome",
    render: (r) => {
      const c = {
        granted:  "text-green-700",
        blocked:  "text-amber-700",
        unknown:  "text-red-700",
        passback: "text-blue-700",
      }[r.outcome] ?? "text-gray-700";
      return html`<span class=${c}>${r.outcome}</span>`;
    },
  },
];

// "2026-05-01T13:24:30.000Z" -> "2026-05-01 13:24:30"
function formatTs(iso) {
  if (!iso) return "";
  return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
}

class AccessLogPage extends LightDomElement {
  static properties = {
    _rows:    { state: true },
    _error:   { state: true },
    _loading: { state: true },
    _groups:  { state: true },
    _users:   { state: true },
    _info:    { state: true },
  };

  constructor() {
    super();
    this._rows = [];
    this._error = "";
    this._loading = false;
    this._groups = [];
    this._users = [];
    this._info = "";
  }

  async connectedCallback() {
    super.connectedCallback();
    // Pull groups + users for the filter dropdowns. Both fail silently -
    // the page still works without them.
    try {
      const [g, u] = await Promise.all([
        apiGet("/groups").catch(() => ({ groups: [] })),
        apiGet("/users?include_deleted=1").catch(() => ({ users: [] })),
      ]);
      this._groups = g.groups ?? [];
      this._users = u.users ?? [];
    } catch { /* ignore */ }
    // Initial load: most recent 500 entries, no filters.
    await this._load({});
  }

  async _load(filters) {
    this._loading = true;
    this._error = "";
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v != null && v !== "") qs.set(k, v);
    }
    const path = `/access-log${qs.toString() ? `?${qs.toString()}` : ""}`;
    try {
      const data = await apiGet(path);
      this._rows = data.access_log;
      this._info = `${data.count} row(s)${data.count >= data.limit ? ` (limit ${data.limit} reached)` : ""}`;
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  _onFilterSubmit(ev) {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const filters = {
      from:     toIsoStart(fd.get("from")),
      to:       toIsoEnd(fd.get("to")),
      group_id: fd.get("group_id"),
      user_id:  fd.get("user_id"),
      fob:      fd.get("fob"),
      outcome:  fd.get("outcome"),
      limit:    fd.get("limit") || 500,
    };
    this._load(filters);
  }

  render() {
    return html`
      <section class="space-y-4">
        <h1 class="text-lg font-semibold">Access log</h1>

        <form @submit=${(ev) => this._onFilterSubmit(ev)}
              class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white border border-gray-200 rounded p-3"
        >
          ${fieldRow({
            label: "From (date)",
            input: html`<input name="from" type="date" class=${TEXT_INPUT}>`,
          })}
          ${fieldRow({
            label: "To (date)",
            input: html`<input name="to" type="date" class=${TEXT_INPUT}>`,
          })}
          ${fieldRow({
            label: "Outcome",
            input: html`
              <select name="outcome" class=${TEXT_INPUT}>
                <option value="">(any)</option>
                <option value="granted">Granted</option>
                <option value="blocked">Blocked</option>
                <option value="unknown">Unknown (intrusion)</option>
                <option value="passback">Passback</option>
              </select>
            `,
          })}
          ${fieldRow({
            label: "Group",
            input: html`
              <select name="group_id" class=${TEXT_INPUT}>
                <option value="">(any)</option>
                ${this._groups.map(
                  (g) => html`<option value=${g.id}>${g.name}</option>`
                )}
              </select>
            `,
          })}
          ${fieldRow({
            label: "User",
            input: html`
              <select name="user_id" class=${TEXT_INPUT}>
                <option value="">(any)</option>
                ${this._users.map(
                  (u) => html`<option value=${u.id}>${u.name}${u.deleted_at ? " (deleted)" : ""}</option>`
                )}
              </select>
            `,
          })}
          ${fieldRow({
            label: "Fob number",
            input: html`<input name="fob" autocomplete="off" inputmode="numeric"
                          class=${`${TEXT_INPUT} font-mono`}>`,
          })}
          <div class="sm:col-span-3 flex gap-2 items-end">
            <button
              type="submit"
              class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white"
            >Apply filters</button>
            <button
              type="reset"
              class="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
              @click=${() => setTimeout(() => this._load({}), 0)}
            >Reset</button>
            <span class="ml-auto text-xs text-gray-500">${this._info}</span>
          </div>
        </form>

        <error-banner .message=${this._error}></error-banner>

        ${this._loading
          ? html`<p class="text-sm text-gray-500 py-4">Loading…</p>`
          : html`
              <data-table
                .columns=${COLUMNS}
                .rows=${this._rows}
                pageSize="50"
                empty="No access-log rows match those filters."
              ></data-table>
            `}
      </section>
    `;
  }
}
customElements.define("access-log-page", AccessLogPage);

// "2026-05-01" -> "2026-05-01T00:00:00Z" so the server's ts >= $from filter
// covers the whole day. Empty string -> null (no filter).
function toIsoStart(d) {
  return d ? `${d}T00:00:00Z` : null;
}
// "2026-05-01" -> "2026-05-01T23:59:59Z" so the inclusive ts <= $to filter
// covers the whole day.
function toIsoEnd(d) {
  return d ? `${d}T23:59:59Z` : null;
}
