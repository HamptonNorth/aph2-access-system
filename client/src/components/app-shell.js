// Top-level frame once signed in. Header + nav + main outlet. The nav
// structure is driven by the NAV constant below so a new link is one entry;
// each entry has a `show?(admin)` predicate that gates it on role flags.
//
// Layout mirrors aph2-diary: dark slate header, max-5xl centred content,
// hamburger drawer on mobile, dropdown groups on desktop.

import { LightDomElement, html } from "../base.js";
import { apiPost } from "../api.js";
import { clearAdmin, getAdmin } from "../store.js";
import { go } from "../router.js";

// Shared anchor click handler. Plain <a href> doesn't re-resolve when href
// === current hash (browser fires no hashchange) which makes "click Users
// while on Users" a silent no-op. Going through go() always calls the
// route resolver. Modifier-click / middle-click bypass this so cmd-click
// still opens in a new tab.
function navClick(href) {
  return (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    go(href.startsWith("#") ? href.slice(1) : href);
  };
}

// Single source of truth for the nav. Each entry is either:
//   { type: "link",   href, label, show?(admin) }
//   { type: "group",  label, show?(admin), items: [...] }
//   { type: "action", label, action }
const NAV = [
  { type: "link", href: "#/", label: "Home" },

  { type: "link", href: "#/users", label: "Users",
    show: (a) => a?.super_user || a?.manage_users },

  { type: "link", href: "#/groups", label: "Groups",
    show: (a) => a?.super_user || a?.manage_groups },

  { type: "link", href: "#/access-log", label: "Access log",
    show: (a) => a?.super_user || a?.view_reports },

  { type: "group", label: "Setup",
    show: (a) => a?.super_user,
    items: [
      { href: "#/admin-users", label: "Admin users" },
      { href: "#/controller",  label: "Controller status" },
    ],
  },

  { type: "action", label: "Sign out", action: "logout" },
];

function visibleEntries(admin) {
  return NAV.filter((e) => !e.show || e.show(admin));
}

const HAMBURGER_D =
  "M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z";
const CLOSE_D =
  "M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z";
const CARET_D = "M5 8l5 5 5-5z";

const icon = (d, extra = "") => html`
  <svg
    xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
    fill="currentColor" class="w-4 h-4 ${extra}" aria-hidden="true"
  ><path fill-rule="evenodd" clip-rule="evenodd" d=${d} /></svg>
`;

const bigIcon = (d) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
    fill="currentColor" class="w-6 h-6" aria-hidden="true"
  ><path fill-rule="evenodd" clip-rule="evenodd" d=${d} /></svg>
`;

class AppShell extends LightDomElement {
  static properties = {
    _menuOpen:  { state: true },
    _openGroup: { state: true },
  };

  constructor() {
    super();
    this._menuOpen = false;
    this._openGroup = null;

    this._onHashChange = () => {
      this._menuOpen = false;
      this._openGroup = null;
    };
    this._onDocClick = (ev) => {
      if (this._openGroup && !ev.target.closest("[data-nav-group]")) {
        this._openGroup = null;
      }
    };
    this._onKeyDown = (ev) => {
      if (ev.key === "Escape") this._openGroup = null;
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("hashchange", this._onHashChange);
    document.addEventListener("click", this._onDocClick);
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("hashchange", this._onHashChange);
    document.removeEventListener("click", this._onDocClick);
    document.removeEventListener("keydown", this._onKeyDown);
    super.disconnectedCallback();
  }

  async _logout() {
    try { await apiPost("/auth/logout"); } catch { /* ignore */ }
    clearAdmin();
    window.dispatchEvent(new Event("aph-auth-changed"));
  }

  _toggleMenu()       { this._menuOpen = !this._menuOpen; }
  _toggleGroup(label) {
    this._openGroup = this._openGroup === label ? null : label;
  }

  render() {
    const admin = getAdmin();
    const entries = visibleEntries(admin);
    return html`
      <header class="bg-slate-800 text-white border-b border-slate-900 relative">
        <div class="max-w-5xl mx-auto px-4 py-2 flex items-center gap-4">
          <a href="#/" class="flex-none flex items-center gap-2" aria-label="Home"
             @click=${navClick("#/")}
          >
            <img src="./header-logo.webp" alt="Audlem Public Hall"
                 class="h-9 w-auto rounded-sm bg-white p-0.5">
            <span class="font-semibold tracking-tight">APH2 Access</span>
          </a>

          <!-- Desktop nav -->
          <nav class="hidden sm:flex items-center gap-1 text-sm">
            ${entries.map((e) => this._renderDesktopEntry(e))}
          </nav>

          <div class="hidden sm:flex ml-auto items-center gap-3 text-sm">
            <span class="text-slate-300">${admin?.username ?? ""}</span>
          </div>

          <button
            type="button"
            class="sm:hidden ml-auto p-1.5 rounded text-white hover:bg-slate-700"
            aria-label="Toggle menu"
            aria-expanded=${this._menuOpen ? "true" : "false"}
            @click=${() => this._toggleMenu()}
          >${bigIcon(this._menuOpen ? CLOSE_D : HAMBURGER_D)}</button>
        </div>

        ${this._menuOpen ? this._renderMobileDrawer(admin, entries) : ""}
      </header>

      <div class="max-w-5xl mx-auto p-4">
        <div id="outlet"></div>
      </div>
    `;
  }

  _renderDesktopEntry(e) {
    if (e.type === "link") {
      return html`
        <a
          href=${e.href}
          class="px-2 py-1 rounded hover:bg-slate-700"
          @click=${navClick(e.href)}
        >${e.label}</a>
      `;
    }
    if (e.type === "action") {
      return html`
        <button
          type="button"
          class="px-2 py-1 rounded hover:bg-slate-700"
          @click=${() => this._logout()}
        >${e.label}</button>
      `;
    }
    // group
    const open = this._openGroup === e.label;
    return html`
      <div class="relative" data-nav-group>
        <button
          type="button"
          class=${`px-2 py-1 rounded hover:bg-slate-700 flex items-center gap-1 ${open ? "bg-slate-700" : ""}`}
          aria-haspopup="true"
          aria-expanded=${open ? "true" : "false"}
          @click=${(ev) => { ev.stopPropagation(); this._toggleGroup(e.label); }}
        >
          ${e.label}
          ${icon(CARET_D, open ? "rotate-180 transition-transform" : "transition-transform")}
        </button>
        ${open ? this._renderDropdown(e) : ""}
      </div>
    `;
  }

  _renderDropdown(group) {
    return html`
      <div
        class="absolute left-0 top-full mt-1 min-w-[14rem] bg-white text-gray-900 border border-gray-200 rounded shadow-md py-1 text-sm z-40"
        @click=${(ev) => ev.stopPropagation()}
      >
        ${group.items.map(
          (item) => html`
            <a
              href=${item.href}
              class="block px-3 py-1.5 hover:bg-slate-50"
              @click=${(ev) => { this._openGroup = null; navClick(item.href)(ev); }}
            >${item.label}</a>
          `
        )}
      </div>
    `;
  }

  _renderMobileDrawer(admin, entries) {
    return html`
      <div class="sm:hidden border-t border-slate-700">
        <nav class="px-4 py-2 flex flex-col text-sm">
          ${entries.map((e) => this._renderMobileEntry(e))}
        </nav>
        <div class="px-4 py-2 border-t border-slate-700 text-xs text-slate-300">
          Signed in as ${admin?.username ?? ""}
        </div>
      </div>
    `;
  }

  _renderMobileEntry(e) {
    if (e.type === "link") {
      return html`<a
        href=${e.href}
        class="px-2 py-2 rounded hover:bg-slate-700"
        @click=${navClick(e.href)}
      >${e.label}</a>`;
    }
    if (e.type === "action") {
      return html`
        <button
          type="button"
          class="text-left px-2 py-2 rounded hover:bg-slate-700"
          @click=${() => this._logout()}
        >${e.label}</button>
      `;
    }
    // group: flatten into a section with indented items.
    return html`
      <div class="mt-2 first:mt-0 px-2 py-1 text-xs uppercase tracking-wide text-slate-300">${e.label}</div>
      ${e.items.map(
        (item) => html`<a
          href=${item.href}
          class="block pl-4 pr-2 py-1.5 rounded hover:bg-slate-700"
          @click=${navClick(item.href)}
        >${item.label}</a>`
      )}
    `;
  }
}
customElements.define("app-shell", AppShell);
