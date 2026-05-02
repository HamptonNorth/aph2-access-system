// Controller status page at #/controller. Shows:
//   * pending / done counts in controller_sync_queue
//   * the last 20 queue rows (for diagnostics)
//   * a placeholder for the "Resync now" button (Phase 2.5 will hook it up)
//
// Until Phase 2.5 ships, the queue just keeps growing - admins can see what
// will be replayed when the worker comes online.

import { LightDomElement, html } from "../base.js";
import { apiGet } from "../api.js";
import "./data-table.js";
import "./error-banner.js";

const COLUMNS = [
  { key: "id", label: "#", align: "right" },
  { key: "enqueued_at", label: "Enqueued at" },
  { key: "action", label: "Action" },
  { key: "fob_number", label: "Fob" },
  {
    key: "done",
    label: "Status",
    render: (r) => r.done
      ? html`<span class="text-green-700">done</span>`
      : html`<span class="text-amber-700">pending</span>`,
  },
  { key: "attempts", label: "Tries", align: "right" },
];

class ControllerStatus extends LightDomElement {
  static properties = {
    _data:    { state: true },
    _error:   { state: true },
    _loading: { state: true },
  };

  constructor() {
    super();
    this._data = null;
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
      this._data = await apiGet("/controller/status");
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  render() {
    return html`
      <section class="space-y-4">
        <div class="flex items-center justify-between">
          <h1 class="text-lg font-semibold">Controller status</h1>
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-sm"
            @click=${() => this._load()}
          >Refresh</button>
        </div>

        <error-banner .message=${this._error}></error-banner>

        ${this._loading
          ? html`<p class="text-sm text-gray-500 py-4">Loading…</p>`
          : this._renderBody()}
      </section>
    `;
  }

  _renderBody() {
    const d = this._data ?? { pending: 0, done: 0, recent: [] };
    return html`
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        ${this._tile("Pending", d.pending, "amber")}
        ${this._tile("Done",    d.done,    "green")}
        ${this._tile("Total",   d.total ?? (d.pending + d.done), "slate")}
      </div>

      <p class="text-xs text-gray-500">
        Pending rows are pushed to the controller by the Phase 2.5 worker.
        Until that ships, this queue just records what would be sent.
      </p>

      <h2 class="text-sm font-semibold text-gray-700 mt-4">Recent activity</h2>
      <data-table
        .columns=${COLUMNS}
        .rows=${d.recent ?? []}
        empty="Queue is empty."
      ></data-table>
    `;
  }

  _tile(label, value, colour) {
    const cls = {
      amber: "border-amber-200 bg-amber-50  text-amber-800",
      green: "border-green-200 bg-green-50  text-green-800",
      slate: "border-slate-200 bg-slate-50  text-slate-800",
    }[colour] ?? "border-gray-200 bg-white text-gray-800";
    return html`
      <div class=${`border rounded p-4 ${cls}`}>
        <div class="text-xs uppercase tracking-wide opacity-70">${label}</div>
        <div class="text-2xl font-semibold tabular-nums">${value}</div>
      </div>
    `;
  }
}
customElements.define("controller-status", ControllerStatus);
