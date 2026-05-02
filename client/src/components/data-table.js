// Responsive data table. At >= 640 px it renders a classic <table>; below
// that it stacks each row into a card with label/value pairs. The caller
// provides columns + rows + an optional actions slot.
//
// Cloned verbatim from aph2-diary - same conventions, same look.

import { LightDomElement, html } from "../base.js";

class DataTable extends LightDomElement {
  static properties = {
    columns: { type: Array },
    rows:    { type: Array },
    actions:   { attribute: false },
    clickable: { type: Boolean },
    empty:     { type: String },
    pageSize:  { type: Number },
    _page:     { state: true },
  };

  constructor() {
    super();
    this.columns = [];
    this.rows = [];
    this.actions = null;
    this.clickable = false;
    this.empty = "No rows.";
    this.pageSize = 0;
    this._page = 0;
  }

  updated(changed) {
    // Reset to page 0 whenever the row set or page size changes - otherwise
    // a filter that shrinks the result set can leave _page past the last page.
    if ((changed.has("rows") || changed.has("pageSize")) && this._page !== 0) {
      this._page = 0;
    }
  }

  _fireRowClick(row) {
    if (!this.clickable) return;
    this.dispatchEvent(new CustomEvent("row-click", {
      detail: { row }, bubbles: true, composed: true,
    }));
  }

  _visibleRows() {
    if (!this.pageSize || this.pageSize <= 0) return this.rows;
    const start = this._page * this.pageSize;
    return this.rows.slice(start, start + this.pageSize);
  }

  _pageCount() {
    if (!this.pageSize || this.pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(this.rows.length / this.pageSize));
  }

  render() {
    if (!this.rows?.length) {
      return html`<p class="text-sm text-gray-500 py-4">${this.empty}</p>`;
    }
    return html`
      ${this._tableView()}
      ${this._cardView()}
      ${this._pager()}
    `;
  }

  _pager() {
    const pages = this._pageCount();
    if (pages <= 1) return "";
    const from = this._page * this.pageSize + 1;
    const to = Math.min((this._page + 1) * this.pageSize, this.rows.length);
    return html`
      <div class="flex items-center justify-between gap-2 mt-2 text-sm text-gray-600">
        <span>Showing ${from}–${to} of ${this.rows.length}</span>
        <span class="flex gap-1">
          <button
            type="button"
            class="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
            ?disabled=${this._page === 0}
            @click=${() => { this._page = Math.max(0, this._page - 1); }}
          >Prev</button>
          <span class="px-2 py-1">Page ${this._page + 1} of ${pages}</span>
          <button
            type="button"
            class="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
            ?disabled=${this._page >= pages - 1}
            @click=${() => { this._page = Math.min(pages - 1, this._page + 1); }}
          >Next</button>
        </span>
      </div>
    `;
  }

  _tableView() {
    return html`
      <div class="hidden sm:block overflow-x-auto border border-gray-200 rounded">
        <table class="min-w-full text-sm">
          <thead class="bg-slate-200 text-slate-800">
            <tr>
              ${this.columns.map(
                (c) => html`<th class=${`${c.align === "right" ? "text-right" : "text-left"} font-medium px-3 py-2`}>${c.label}</th>`
              )}
              ${this.actions
                ? html`<th class="text-right font-medium px-3 py-2 w-px"></th>`
                : ""}
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            ${this._visibleRows().map(
              (row, idx) => html`
                <tr
                  class=${`${idx % 2 === 1 ? "bg-slate-50" : "bg-white"} hover:bg-slate-100 ${this.clickable ? "cursor-pointer" : ""}`}
                  @click=${() => this._fireRowClick(row)}
                >
                  ${this.columns.map(
                    (c) => html`<td class=${`px-3 py-2 align-middle ${c.align === "right" ? "text-right" : ""}`}>${this._cellValue(row, c)}</td>`
                  )}
                  ${this.actions
                    ? html`<td class="px-3 py-2 text-right whitespace-nowrap align-middle">${this.actions(row)}</td>`
                    : ""}
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _cardView() {
    return html`
      <ul class="sm:hidden space-y-2">
        ${this._visibleRows().map(
          (row) => html`
            <li
              class=${`border border-gray-200 rounded p-3 bg-white ${this.clickable ? "cursor-pointer" : ""}`}
              @click=${() => this._fireRowClick(row)}
            >
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                ${this.columns.map(
                  (c) => html`
                    <dt class="text-gray-500">${c.label}</dt>
                    <dd>${this._cellValue(row, c)}</dd>
                  `
                )}
              </dl>
              ${this.actions
                ? html`<div class="mt-2 flex justify-end gap-2">${this.actions(row)}</div>`
                : ""}
            </li>
          `
        )}
      </ul>
    `;
  }

  _cellValue(row, col) {
    if (typeof col.render === "function") return col.render(row);
    const v = row[col.key];
    return v == null || v === "" ? html`<span class="text-gray-500">&mdash;</span>` : v;
  }
}
customElements.define("data-table", DataTable);
