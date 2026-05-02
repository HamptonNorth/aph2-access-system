// Red strip at the top of a view. Self-hides when the `message` property is
// empty.
//
//   import "./error-banner.js";
//   ...
//   <error-banner .message=${this._error}></error-banner>

import { LightDomElement, html } from "../base.js";

class ErrorBanner extends LightDomElement {
  static properties = {
    message: { type: String },
  };

  constructor() {
    super();
    this.message = "";
  }

  render() {
    if (!this.message) return html``;
    return html`
      <div role="alert"
           class="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm">
        ${this.message}
      </div>
    `;
  }
}
customElements.define("error-banner", ErrorBanner);
