// Form-field template helper. NOT a custom element.
//
// In light-DOM Lit (no shadow root) the `<slot>` mechanism doesn't project
// children, so a form-field custom element would end up with its input
// appearing above the label. We avoid that entirely by exporting a plain
// template function that returns label + input + help/error as a single
// template - callers pass the input itself via the `input` property.
//
//   import { fieldRow } from "./form-field.js";
//   ...
//   ${fieldRow({
//     label: "Name",
//     input: html`<input name="name" required ...>`,
//   })}

import { html } from "../base.js";

export function fieldRow({ label = "", input, help = "", error = "" }) {
  return html`
    <div class="space-y-1">
      ${label
        ? html`<label class="block text-sm text-gray-700">${label}</label>`
        : ""}
      ${input}
      ${help  ? html`<p class="text-xs text-gray-500">${help}</p>` : ""}
      ${error ? html`<p class="text-xs text-red-600">${error}</p>` : ""}
    </div>
  `;
}
