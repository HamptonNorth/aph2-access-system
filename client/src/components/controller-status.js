// Controller status page at #/controller. Shows:
//   * the latest health-check ping (online / offline / unknown) plus a
//     small dot strip of the last 20 pings
//   * pending / done counts in controller_sync_queue
//   * the last 20 queue rows (for diagnostics)
//   * a placeholder for the "Resync now" button (Phase 2.5 will hook it up)
//
// Auto-refreshes every 30 seconds while the page is mounted so the "last
// ping" display stays current without manual taps. Manual Refresh button
// stays for impatient admins.

import { LightDomElement, html } from "../base.js";
import { apiGet } from "../api.js";
import "./data-table.js";
import "./error-banner.js";

const REFRESH_MS = 30_000;

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
    this._refreshTimer = null;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._load();
    // Background refresh so a long-open tab keeps the "last ping" line
    // alive. Don't refresh while the tab is hidden - wakes the server up
    // for nothing.
    this._refreshTimer = setInterval(() => {
      if (!document.hidden) this._load();
    }, REFRESH_MS);
  }

  disconnectedCallback() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    super.disconnectedCallback();
  }

  async _load() {
    this._loading = this._data == null;   // only show big "Loading…" first time
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
    const d = this._data ?? { pending: 0, done: 0, total: 0, recent: [], health: null };
    return html`
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        ${this._healthTile(d.health)}
        ${this._tile("Pending", d.pending, "amber")}
        ${this._tile("Done",    d.done,    "green")}
        ${this._tile("Total",   d.total ?? (d.pending + d.done), "slate")}
      </div>

      ${this._renderHealthDetail(d.health)}

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

  _healthTile(health) {
    if (!health) return this._tile("Controller", "—", "slate");
    const cls = {
      up:      "border-green-200 bg-green-50 text-green-800",
      down:    "border-red-200   bg-red-50   text-red-800",
      unknown: "border-gray-200  bg-gray-50  text-gray-700",
    }[health.status] ?? "border-gray-200 bg-gray-50 text-gray-700";
    const label = {
      up:      "online",
      down:    "offline",
      unknown: "unknown",
    }[health.status] ?? "unknown";
    return html`
      <div class=${`border rounded p-4 ${cls}`}>
        <div class="text-xs uppercase tracking-wide opacity-70">Controller</div>
        <div class="text-2xl font-semibold">${label}</div>
      </div>
    `;
  }

  _renderHealthDetail(health) {
    if (!health || !health.last_pinged_at) {
      return html`<p class="text-xs text-gray-500">No health-check ping data yet.</p>`;
    }
    const lastTs = formatTs(health.last_pinged_at);
    const latency = health.last_latency_ms != null
      ? `${health.last_latency_ms} ms` : "—";
    // Reverse so dots render oldest-on-the-left, newest-on-the-right -
    // reads naturally as a small timeline.
    const dots = (health.recent ?? []).slice().reverse();
    return html`
      <div class="text-xs text-gray-600 space-y-1">
        <p>Last ping <span class="font-mono">${lastTs}</span> · response ${latency} · ${health.ping_count} ping(s) since boot</p>
        ${health.consecutive_failures > 0
          ? html`<p class="text-red-700">${health.consecutive_failures} consecutive failure(s)</p>`
          : ""}
        ${dots.length > 0
          ? html`
              <div class="flex gap-1 mt-1" aria-label="Recent ping outcomes (oldest to newest)">
                ${dots.map((p) => html`
                  <span
                    class=${`inline-block w-2 h-3 rounded ${p.ok ? "bg-green-500" : "bg-red-500"}`}
                    title=${pingTooltip(p)}
                  ></span>
                `)}
              </div>
            `
          : ""}
      </div>
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

// "2026-05-01T13:24:30.000Z" -> "2026-05-01 13:24:30"
function formatTs(iso) {
  if (!iso) return "";
  return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
}

function pingTooltip(p) {
  const t = formatTs(p.ts);
  return p.ok ? `${t} · ${p.latency_ms} ms` : `${t} · ${p.error ?? "failed"}`;
}
