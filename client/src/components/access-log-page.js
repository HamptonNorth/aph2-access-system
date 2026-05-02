// Access-log viewer at #/access-log. Filters: date + time range, group,
// user (typeahead), fob (single or comma-separated list), outcome.
//
// On first load the form auto-applies a "last X minutes" window where X
// comes from config/client.json (access_log.default_from_minutes), so the
// admin lands on something useful instead of a 500-row dump of the whole
// year.
//
// Time handling: the date / time inputs are interpreted in the BROWSER'S
// local timezone (so a user in BST picking 14:00 means UK 14:00). We
// convert to UTC ISO via Date.toISOString() before sending - the server
// stores everything in UTC.

import { LightDomElement, html } from "../base.js";
import { apiGet } from "../api.js";
import { fieldRow } from "./form-field.js";
import { getClientConfig } from "../store.js";
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

// Local-date helpers: getFullYear / getMonth / getDate are LOCAL, which is
// what we want - the date / time inputs are interpreted in the browser's
// own timezone.
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm  = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

class AccessLogPage extends LightDomElement {
  static properties = {
    _rows:    { state: true },
    _error:   { state: true },
    _loading: { state: true },
    _groups:  { state: true },
    _users:   { state: true },
    _info:    { state: true },

    // The user typeahead. _userQuery is the visible text in the input;
    // _userMatches is the live-filtered list (max 10); _userSelectedId
    // is set when a row is picked. Empty input = no user filter.
    _userQuery:      { state: true },
    _userMatches:    { state: true },
    _userSelectedId: { state: true },
    _userListOpen:   { state: true },

    // Defaults derived from client config; populated in connectedCallback
    // so first paint already shows the "last X minutes" window.
    _defaults: { state: true },

    // Show / hide the filter form. Open by default so first-time visitors
    // see the controls; closing it gives back the screen for the table.
    _filtersOpen: { state: true },

    // Snapshot of whatever filters the currently-displayed table was loaded
    // with. Drives the one-line summary that appears above the table when
    // the filter form is collapsed.
    _appliedFilters: { state: true },
  };

  constructor() {
    super();
    this._rows = [];
    this._error = "";
    this._loading = false;
    this._groups = [];
    this._users = [];
    this._info = "";

    this._userQuery = "";
    this._userMatches = [];
    this._userSelectedId = null;
    this._userListOpen = false;

    this._defaults = { fromDate: "", fromTime: "00:00", toDate: "", toTime: "23:59" };
    this._filtersOpen = true;
    this._appliedFilters = null;
  }

  async connectedCallback() {
    super.connectedCallback();

    // Compute the default window: from = now - X minutes; to = from + D
    // minutes (a fixed-duration window). Specifying "to" as a duration
    // rather than an offset from "now" makes the window a single
    // self-contained interval the admin can shift around without it
    // mysteriously growing or shrinking. Both X (default_from_minutes_ago)
    // and D (default_duration_minutes) live in config/client.json.
    const cfg = getClientConfig();
    const minutesAgo  = cfg.access_log?.default_from_minutes_ago ?? 60;
    const durationMin = cfg.access_log?.default_duration_minutes ?? 20;
    const now  = new Date();
    const from = new Date(now.getTime()  - minutesAgo  * 60 * 1000);
    const to   = new Date(from.getTime() + durationMin * 60 * 1000);
    this._defaults = {
      fromDate: ymd(from),
      fromTime: hm(from),
      toDate:   ymd(to),
      toTime:   hm(to),
    };

    // Pull groups + users for the filters. Both fail silently - the page
    // still works without them.
    try {
      const [g, u] = await Promise.all([
        apiGet("/groups").catch(() => ({ groups: [] })),
        apiGet("/users?include_deleted=1").catch(() => ({ users: [] })),
      ]);
      this._groups = g.groups ?? [];
      this._users = u.users ?? [];
    } catch { /* ignore */ }

    // Initial load: apply the default window straight away.
    await this._load(this._currentFilters());
  }

  // Build the filters object the route handler expects, from whatever's in
  // the form right now (or the defaults if the form hasn't been touched).
  _currentFilters(formEl) {
    const get = (name) => {
      if (!formEl) return null;
      const v = formEl.elements[name]?.value ?? null;
      return v == null || v === "" ? null : v;
    };

    const fromDate = get("from_date") ?? this._defaults.fromDate;
    const fromTime = get("from_time") ?? this._defaults.fromTime;
    const toDate   = get("to_date")   ?? this._defaults.toDate;
    const toTime   = get("to_time")   ?? this._defaults.toTime;

    return {
      from:     localToIso(fromDate, fromTime || "00:00"),
      to:       localToIso(toDate,   toTime   || "23:59"),
      group_id: get("group_id"),
      user_id:  this._userSelectedId,
      fob:      get("fob"),                      // server splits on comma + pads
      outcome:  get("outcome"),
      limit:    get("limit") || 500,
    };
  }

  async _load(filters) {
    this._loading = true;
    this._error = "";
    this._appliedFilters = filters;
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

  // One-line "From dd/mm/yyyy HH:MM to dd/mm/yyyy HH:MM, all outcomes,
  // all groups, all users and fobs 47,909" summary of the LAST APPLIED
  // filter set. Shown above the table when the filter form is collapsed
  // so admins can still see what they're looking at.
  _filtersSummary() {
    const f = this._appliedFilters;
    if (!f) return "";

    const fmt = (iso) => {
      if (!iso) return "—";
      const d = new Date(iso);
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const outcome = f.outcome ? `outcome ${f.outcome}` : "all outcomes";

    const groupLabel = f.group_id
      ? (this._groups.find((g) => g.id === Number(f.group_id))?.name ?? `#${f.group_id}`)
      : null;
    const group = groupLabel ? `group ${groupLabel}` : "all groups";

    const userLabel = f.user_id
      ? (this._users.find((u) => u.id === Number(f.user_id))?.name ?? `#${f.user_id}`)
      : null;
    const user = userLabel ? `user ${userLabel}` : "all users";

    const fobs = f.fob ? `fobs ${f.fob}` : "all fobs";

    return `From ${fmt(f.from)} to ${fmt(f.to)}, ${outcome}, ${group}, ${user} and ${fobs}`;
  }

  _onFilterSubmit(ev) {
    ev.preventDefault();
    this._load(this._currentFilters(ev.target));
  }

  _resetFilters(ev) {
    // Native reset clears form values; we also blank the typeahead state
    // and re-apply the default window.
    setTimeout(() => {
      this._userQuery = "";
      this._userSelectedId = null;
      this._userMatches = [];
      this._userListOpen = false;
      const form = ev.target.closest("form");
      // Restore defaults on the date / time inputs (the native reset
      // clears them rather than going to defaultValue here, because we
      // set values via .value rather than the value attribute).
      if (form) {
        if (form.elements.from_date) form.elements.from_date.value = this._defaults.fromDate;
        if (form.elements.from_time) form.elements.from_time.value = this._defaults.fromTime;
        if (form.elements.to_date)   form.elements.to_date.value   = this._defaults.toDate;
        if (form.elements.to_time)   form.elements.to_time.value   = this._defaults.toTime;
      }
      this._load(this._currentFilters(form));
    }, 0);
  }

  // ---- user typeahead ----

  _onUserType(ev) {
    const v = ev.target.value ?? "";
    this._userQuery = v;
    // Typing always invalidates a previously-picked id - the dropdown is
    // the only authoritative way to pick.
    this._userSelectedId = null;

    const q = v.trim().toLowerCase();
    if (!q) {
      this._userMatches = [];
      this._userListOpen = false;
      return;
    }
    this._userMatches = this._users
      .filter((u) => (u.name ?? "").toLowerCase().includes(q))
      .slice(0, 10);
    this._userListOpen = this._userMatches.length > 0;
  }

  _pickUser(u) {
    this._userQuery = u.name ?? "";
    this._userSelectedId = u.id;
    this._userListOpen = false;
  }

  _onUserBlur() {
    // Delay the close so an in-progress click on a dropdown row still
    // registers (mousedown -> click can be after blur otherwise).
    setTimeout(() => { this._userListOpen = false; }, 150);
  }

  _onUserFocus() {
    if (this._userMatches.length > 0) this._userListOpen = true;
  }

  // ---- film-strip launcher ----

  _openFilmStrip(row) {
    const dlg = document.createElement("film-strip-dialog");
    dlg.accessLogId = row.id;
    dlg.swipeTime   = row.ts;
    dlg.fobNumber   = row.fob_number;
    dlg.userName    = row.user_name ?? "";
    document.body.appendChild(dlg);
  }

  _renderVideoButton(row) {
    return html`
      <button type="button"
        class="text-slate-700 hover:text-slate-900"
        aria-label="View door footage"
        title="View door footage"
        @click=${() => this._openFilmStrip(row)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
             fill="currentColor" class="w-5 h-5" aria-hidden="true">
          <path d="M3 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm15.5 4 4-2.5v9l-4-2.5v-4Z"/>
        </svg>
      </button>
    `;
  }

  render() {
    const d = this._defaults;
    return html`
      <section class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-lg font-semibold">Access log</h1>
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-sm"
            @click=${() => { this._filtersOpen = !this._filtersOpen; }}
          >${this._filtersOpen ? "Hide filters" : "Show filters"}</button>
        </div>

        <!-- Wrapper owns the show/hide. The form has display:grid from
             Tailwind, which would outrank [hidden]'s display:none if the
             attribute lived on the form itself. -->
        <div ?hidden=${!this._filtersOpen}>
        <form @submit=${(ev) => this._onFilterSubmit(ev)}
              class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white border border-gray-200 rounded p-3"
        >
          ${fieldRow({
            label: "From date",
            input: html`<input name="from_date" type="date"
                          .value=${d.fromDate}
                          class=${TEXT_INPUT}>`,
          })}
          ${fieldRow({
            label: "From time",
            input: html`<input name="from_time" type="time"
                          .value=${d.fromTime}
                          class=${TEXT_INPUT}>`,
          })}
          ${fieldRow({
            label: "To date",
            input: html`<input name="to_date" type="date"
                          .value=${d.toDate}
                          class=${TEXT_INPUT}>`,
          })}
          ${fieldRow({
            label: "To time",
            input: html`<input name="to_time" type="time"
                          .value=${d.toTime}
                          class=${TEXT_INPUT}>`,
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
          ${this._renderUserTypeahead()}
          ${fieldRow({
            label: "Fob number(s)",
            help:  "Single value or comma-separated list. Leading zeros optional - 1234 matches 0000001234.",
            input: html`<input name="fob" autocomplete="off"
                          .value=${""}
                          class=${`${TEXT_INPUT} font-mono`}>`,
          })}
          <div class="sm:col-span-3 flex gap-2 items-end">
            <button
              type="submit"
              class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white"
            >Apply filters</button>
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
              @click=${(ev) => this._resetFilters(ev)}
            >Reset</button>
            <span class="ml-auto text-xs text-gray-500">${this._info}</span>
          </div>
        </form>
        </div>

        <error-banner .message=${this._error}></error-banner>

        ${!this._filtersOpen && this._appliedFilters
          ? html`<p class="text-xs text-gray-500">${this._filtersSummary()}</p>`
          : ""}

        ${this._loading
          ? html`<p class="text-sm text-gray-500 py-4">Loading…</p>`
          : html`
              <data-table
                .columns=${COLUMNS}
                .rows=${this._rows}
                .actions=${(row) => this._renderVideoButton(row)}
                pageSize="50"
                empty="No access-log rows match those filters."
              ></data-table>
            `}
      </section>
    `;
  }

  _renderUserTypeahead() {
    return fieldRow({
      label: "User",
      help:  "Type a name; pick from the matches.",
      input: html`
        <div class="relative">
          <input type="search"
            placeholder="(any)"
            autocomplete="off"
            .value=${this._userQuery}
            @input=${(ev) => this._onUserType(ev)}
            @focus=${() => this._onUserFocus()}
            @blur=${() => this._onUserBlur()}
            class=${TEXT_INPUT}
          >
          ${this._userListOpen ? html`
            <ul class="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-md max-h-60 overflow-auto text-sm">
              ${this._userMatches.map((u) => html`
                <li
                  class="px-3 py-1.5 hover:bg-slate-50 cursor-pointer flex justify-between gap-3"
                  @mousedown=${() => this._pickUser(u)}
                >
                  <span>${u.name}${u.deleted_at ? html`<span class="text-xs text-gray-500 ml-1">(deleted)</span>` : ""}</span>
                  <span class="text-xs text-gray-500 font-mono">${u.fob_number ?? ""}</span>
                </li>
              `)}
            </ul>
          ` : ""}
        </div>
      `,
    });
  }
}
customElements.define("access-log-page", AccessLogPage);

// "2026-05-02" + "13:24" -> "2026-05-02T12:24:00.000Z" (in BST). Treats the
// inputs as local time; toISOString() converts to UTC for the server. If
// either value is missing we return null so the filter is dropped.
function localToIso(date, time) {
  if (!date) return null;
  const [hh, mm, ss] = (time || "00:00:00").split(":");
  const local = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(hh || 0),
    Number(mm || 0),
    Number(ss || 0),
    0,
  );
  return local.toISOString();
}
