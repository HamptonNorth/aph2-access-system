// Simple "are you sure?" modal. Fires a `confirm` or `cancel` CustomEvent
// and closes itself. Callers create / remove it imperatively:
//
//   const dlg = document.createElement("confirm-dialog");
//   dlg.message = `Delete ${row.name}?`;
//   dlg.addEventListener("confirm", () => { ... });
//   document.body.appendChild(dlg);

import { LightDomElement, html } from "../base.js";

class ConfirmDialog extends LightDomElement {
  static properties = {
    message:     { type: String },
    confirmText: { type: String },
    cancelText:  { type: String },
  };

  constructor() {
    super();
    this.message = "Are you sure?";
    this.confirmText = "Confirm";
    this.cancelText = "Cancel";
  }

  _fire(name) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    this.remove();
  }

  render() {
    return html`
      <div
        class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        @click=${(ev) => { if (ev.target === ev.currentTarget) this._fire("cancel"); }}
      >
        <div class="w-full max-w-sm bg-white rounded-lg shadow-lg p-4 space-y-4">
          <p class="text-sm text-gray-800">${this.message}</p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
              @click=${() => this._fire("cancel")}
            >${this.cancelText}</button>
            <button
              type="button"
              class="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700"
              @click=${() => this._fire("confirm")}
            >${this.confirmText}</button>
          </div>
        </div>
      </div>
    `;
  }
}
customElements.define("confirm-dialog", ConfirmDialog);
