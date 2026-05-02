// Film-strip viewer modal. Opened imperatively from the access-log page:
//
//   const dlg = document.createElement("film-strip-dialog");
//   dlg.accessLogId = row.id;
//   dlg.swipeTime   = row.ts;
//   dlg.fobNumber   = row.fob_number;
//   dlg.userName    = row.user_name || "";
//   document.body.appendChild(dlg);
//
// On connect it fetches /api/access-log/:id/film-strip and renders the
// frames in a horizontal grid with their timestamps below. ESC or
// click-outside closes the modal.

import { LightDomElement, html } from "../base.js";
import { apiGet } from "../api.js";

class FilmStripDialog extends LightDomElement {
  static properties = {
    accessLogId: { type: Number },
    swipeTime:   { type: String },
    fobNumber:   { type: String },
    userName:    { type: String },
    _frames:     { state: true },
    _mode:       { state: true },
    _loading:    { state: true },
    _error:      { state: true },
  };

  constructor() {
    super();
    this.accessLogId = null;
    this.swipeTime = "";
    this.fobNumber = "";
    this.userName = "";
    this._frames = [];
    this._mode = "demo";
    this._loading = true;
    this._error = "";
  }

  async connectedCallback() {
    super.connectedCallback();
    this._onKey = (ev) => { if (ev.key === "Escape") this.remove(); };
    document.addEventListener("keydown", this._onKey);

    if (this.accessLogId == null) {
      this._error = "missing accessLogId";
      this._loading = false;
      return;
    }

    try {
      const data = await apiGet(`/access-log/${this.accessLogId}/film-strip`);
      this._frames = data.frames ?? [];
      this._mode   = data.mode ?? "demo";
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this._onKey);
    super.disconnectedCallback();
  }

  render() {
    return html`
      <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
           @click=${(ev) => { if (ev.target === ev.currentTarget) this.remove(); }}>
        <div class="bg-white rounded shadow-lg max-w-6xl w-full p-4 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold">Door footage</h2>
              <p class="text-xs text-gray-500">
                Swipe at ${formatTs(this.swipeTime)} · fob ${this.fobNumber}${this.userName ? ` · ${this.userName}` : ""}
              </p>
            </div>
            <button type="button" class="text-gray-500 hover:text-gray-800 text-xl leading-none px-1"
                    aria-label="Close"
                    @click=${() => this.remove()}>×</button>
          </div>

          ${this._loading
            ? html`
                <div class="py-10 flex flex-col items-center gap-2 text-gray-500">
                  <svg class="animate-spin h-8 w-8 text-slate-500" viewBox="0 0 24 24"
                       fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"></circle>
                    <path fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"></path>
                  </svg>
                  <p class="text-sm">Fetching frames from DVR…</p>
                </div>
              `
            : this._error
              ? html`<p class="text-sm text-red-600">${this._error}</p>`
              : html`
                <div class="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  ${this._frames.map((f) => html`
                    <figure class="space-y-1">
                      <img src=${f.url} alt="frame"
                           class="w-full h-auto rounded border border-gray-200 bg-gray-100"
                           loading="lazy">
                      <figcaption class="text-xs text-gray-500 text-center font-mono">${formatTs(f.ts)}</figcaption>
                    </figure>
                  `)}
                </div>
                ${this._mode === "demo"
                  ? html`<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      Demo mode — frames are simulated. Live HikVision ISAPI integration ships when the DVR is on the network.
                    </p>`
                  : ""}
              `}
        </div>
      </div>
    `;
  }
}
customElements.define("film-strip-dialog", FilmStripDialog);

// "2026-05-01T13:24:30.000Z" -> "2026-05-01 13:24:30"
function formatTs(iso) {
  if (!iso) return "";
  return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
}
