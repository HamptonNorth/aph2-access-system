// Project-wide Lit base class: renders into the light DOM (not a shadow root)
// so Tailwind utility classes cascade from the global stylesheet. Every
// custom element in this app extends LightDomElement.

import { LitElement } from "lit";

export class LightDomElement extends LitElement {
  createRenderRoot() {
    return this;
  }
}

// Re-export the Lit template tag from a single place so component files only
// need one import.
export { html } from "lit";
