import "./styles.css";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_CATALOG,
  createDocumentFromTemplate,
  updateMeta
} from "./data.js";
import {
  analyzeWorkspaceImport,
  clearWorkspaceStorage,
  createDocument,
  exportWorkspace,
  getWorkspaceStorageSummary,
  importWorkspace,
  isWorkspaceStorageKey,
  loadWorkspace,
  saveWorkspaceIndex,
  saveDocument,
  updateDocumentIndex
} from "./storage.js";
import { CommandRegistry, createCommandPalette } from "./commands.js";
import { createWriterApp } from "./apps/writer.js";
import { createSheetsApp } from "./apps/sheets.js";
import { createSlidesApp } from "./apps/slides.js";
import { createBaseApp } from "./apps/base.js";
import { createHistory, snapshotDocument } from "./history.js";

const root = document.querySelector("#app");
const registry = new CommandRegistry();
const workspace = loadWorkspace();
let currentDocId = workspace.index.documents[0]?.id ?? null;
let currentView = "library";
let autosaveTimer = null;
let searchQuery = "";
let toastTimer = null;
let activeDialog = null;
let libraryViewMode = "grid";
let librarySortMode = "recent";
let createDialogState = null;
let lastLibraryAction = null;
let concurrentEditPrompted = false;
let activeContextMenu = null;

const SETTINGS_KEY = "workspot.settings";
const SESSION_KEY = "workspot.session";
const settings = loadSettings();
const shortcutRegistry = createShortcutRegistry();
const historyByDoc = new Map();

const appRenderers = {
  writer: createWriterApp,
  sheets: createSheetsApp,
  slides: createSlidesApp,
  base: createBaseApp
};

const appState = {
  workspace,
  currentDoc() {
    return workspace.documents[currentDocId];
  }
};
let pendingRecovery = loadSessionState();

function loadSessionState() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function saveSessionState(state) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

function updateSessionState({ clean = false } = {}) {
  saveSessionState({
    clean,
    lastView: currentView,
    lastDocId: currentDocId,
    updatedAt: new Date().toISOString()
  });
}

function markSessionClean() {
  const session = loadSessionState();
  saveSessionState({
    ...session,
    clean: true,
    lastView: currentView,
    lastDocId: currentDocId,
    updatedAt: new Date().toISOString()
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function refreshStorageUsage() {
  const usageEl = document.querySelector("[data-storage-usage]");
  if (!usageEl) return;
  const { workspaceBytes } = getWorkspaceStorageSummary();
  usageEl.textContent = formatBytes(workspaceBytes);
}

function scheduleAutosave(doc) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    updateMeta(doc);
    saveDocument(doc, { snapshot: true });
    workspace.index = updateDocumentIndex(workspace.index, doc);
    renderStatus(`Autosaved at ${new Date().toLocaleTimeString()}`);
  }, 600);
}

function switchDocument(docId) {
  currentDocId = docId;
  currentView = "editor";
  render();
}

function createDocumentCopy(doc, { suffix = "Copy", switchTo = true } = {}) {
  const copy = createDocumentFromTemplate(doc.type, doc.meta.template || "blank");
  if (!copy) return null;
  copy.meta.title = `${doc.meta.title} (${suffix})`;
  copy.content = doc.content ? JSON.parse(JSON.stringify(doc.content)) : copy.content;
  copy.sheets = doc.sheets ? JSON.parse(JSON.stringify(doc.sheets)) : copy.sheets;
  copy.slides = doc.slides ? JSON.parse(JSON.stringify(doc.slides)) : copy.slides;
  copy.tables = doc.tables ? JSON.parse(JSON.stringify(doc.tables)) : copy.tables;
  copy.relationships = doc.relationships
    ? JSON.parse(JSON.stringify(doc.relationships))
    : copy.relationships;
  workspace.index = createDocument(workspace.index, copy);
  workspace.documents[copy.id] = copy;
  if (switchTo) {
    currentDocId = copy.id;
    currentView = "editor";
  }
  return copy;
}

function renderStatus(message) {
  const status = document.querySelector(".status-bar__message");
  if (status) {
    status.textContent = message;
  }
  showToast(message);
}

function getHistory(doc) {
  if (!doc) return null;
  if (!historyByDoc.has(doc.id)) {
    const history = createHistory(() => snapshotDocument(workspace.documents[doc.id]));
    historyByDoc.set(doc.id, history);
  }
  return historyByDoc.get(doc.id);
}

function renderAnnouncement(message) {
  const announcer = document.querySelector(".status-bar__announcer");
  if (announcer) {
    announcer.textContent = "";
    window.requestAnimationFrame(() => {
      announcer.textContent = message;
    });
  }
}

function createShortcutRegistry() {
  const entries = [];
  const conflicts = [];
  const index = new Map();

  const normalizeKey = (value) => {
    if (!value) return "";
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    const alias = {
      esc: "Escape",
      escape: "Escape",
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      "↑": "ArrowUp",
      "↓": "ArrowDown",
      "←": "ArrowLeft",
      "→": "ArrowRight"
    };
    if (alias[lower]) return alias[lower];
    if (trimmed.length === 1) return trimmed.toLowerCase();
    return trimmed;
  };

  const parse = (keys) => {
    const parts = keys
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    const modifiers = new Set();
    let key = "";
    parts.forEach((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl/cmd" || lower === "cmd/ctrl" || lower === "mod") {
        modifiers.add("mod");
        return;
      }
      if (lower === "ctrl" || lower === "control") {
        modifiers.add("ctrl");
        return;
      }
      if (lower === "cmd" || lower === "command" || lower === "meta") {
        modifiers.add("meta");
        return;
      }
      if (lower === "shift") {
        modifiers.add("shift");
        return;
      }
      if (lower === "alt" || lower === "option") {
        modifiers.add("alt");
        return;
      }
      key = part;
    });
    const normalizedKey = normalizeKey(key || parts[parts.length - 1]);
    const sortedModifiers = Array.from(modifiers).sort().join("+");
    return {
      key: normalizedKey,
      modifiers,
      normalized: `${sortedModifiers}${sortedModifiers ? "+" : ""}${normalizedKey}`
    };
  };

  const matches = (event, entry) => {
    const normalizedKey = normalizeKey(event.key);
    if (normalizedKey !== entry.key) return false;
    const required = entry.modifiers;
    const requiresMod = required.has("mod");
    const requiresCtrl = required.has("ctrl");
    const requiresMeta = required.has("meta");
    const requiresAlt = required.has("alt");
    const requiresShift = required.has("shift");
    if (requiresMod && !(event.ctrlKey || event.metaKey)) return false;
    if (requiresCtrl && !event.ctrlKey) return false;
    if (requiresMeta && !event.metaKey) return false;
    if (requiresAlt && !event.altKey) return false;
    if (requiresShift && !event.shiftKey) return false;
    if (!requiresMod && !requiresCtrl && !requiresMeta && (event.ctrlKey || event.metaKey)) {
      return false;
    }
    if (!requiresAlt && event.altKey) return false;
    return true;
  };

  const register = ({ id, keys, description, scope = "global", action }) => {
    const parsed = parse(keys);
    const entry = { id, keys, description, scope, action, ...parsed };
    const indexKey = `${scope}:${parsed.normalized}`;
    const conflictsWith = (existing) => {
      conflicts.push({
        scope,
        keys,
        existingId: existing.id,
        newId: id
      });
      console.warn(
        `Shortcut conflict for ${scope} ${keys}: ${existing.id} vs ${id}.`
      );
    };
    if (index.has(indexKey)) {
      conflictsWith(index.get(indexKey));
      return false;
    }
    if (scope === "global") {
      const existing = entries.find((item) => item.normalized === parsed.normalized);
      if (existing) {
        conflictsWith(existing);
        return false;
      }
    } else {
      const existing = entries.find(
        (item) => item.scope === "global" && item.normalized === parsed.normalized
      );
      if (existing) {
        conflictsWith(existing);
        return false;
      }
    }
    index.set(indexKey, entry);
    entries.push(entry);
    return true;
  };

  const list = (appType) =>
    entries.filter((entry) => entry.scope === "global" || entry.scope === appType);

  const findMatch = (event, appType) =>
    list(appType).find((entry) => matches(event, entry));

  const getConflicts = () => conflicts.slice();

  return {
    register,
    list,
    findMatch,
    getConflicts
  };
}

function isTextInput(target) {
  if (!target) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']")
  );
}

function closeDialog() {
  if (!activeDialog) return;
  activeDialog.remove();
  activeDialog = null;
  createDialogState = null;
}

function closeContextMenu() {
  if (!activeContextMenu) return;
  activeContextMenu.remove();
  activeContextMenu = null;
}

function focusMenuItem(menu, index) {
  const items = Array.from(menu.querySelectorAll("button:not([disabled])"));
  if (!items.length) return;
  const nextIndex = (index + items.length) % items.length;
  items[nextIndex]?.focus();
}

function openContextMenu({ x, y, items = [] }) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Context menu");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  items.forEach((item) => {
    if (item.type === "divider") {
      const divider = document.createElement("div");
      divider.className = "context-menu__divider";
      menu.appendChild(divider);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-menu__item";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    if (item.disabled) {
      button.disabled = true;
      button.classList.add("disabled");
    }
    button.addEventListener("click", () => {
      if (item.disabled) return;
      item.onSelect?.();
      closeContextMenu();
    });
    menu.appendChild(button);
  });
  menu.addEventListener("keydown", (event) => {
    const itemsList = Array.from(menu.querySelectorAll("button:not([disabled])"));
    const activeIndex = itemsList.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem(menu, activeIndex + 1);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(menu, activeIndex - 1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(menu, 0);
    }
    if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(menu, itemsList.length - 1);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeContextMenu();
    }
  });

  const onClickOutside = (event) => {
    if (!menu.contains(event.target)) {
      closeContextMenu();
      document.removeEventListener("click", onClickOutside);
    }
  };
  document.addEventListener("click", onClickOutside);

  document.body.appendChild(menu);
  activeContextMenu = menu;
  focusMenuItem(menu, 0);
}

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute("disabled"));
}

function applyFocusTrap(modal) {
  const content = modal.querySelector(".modal__content") ?? modal;
  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = getFocusableElements(content);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function focusFirstElement(modal) {
  const content = modal.querySelector(".modal__content") ?? modal;
  const focusable = getFocusableElements(content);
  if (focusable.length) {
    focusable[0].focus();
  } else if (content) {
    content.focus();
  }
}

function openDialog({ title, message, content, actions = [] }) {
  closeDialog();
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.dataset.modal = "dialog";
  const bodyContent = document.createElement("div");
  bodyContent.className = "modal__body";
  if (message) {
    const paragraph = document.createElement("p");
    paragraph.className = "modal__message";
    paragraph.textContent = message;
    bodyContent.appendChild(paragraph);
  }
  if (content) {
    bodyContent.appendChild(content);
  }
  const footer = document.createElement("div");
  footer.className = "modal__footer";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.primary ? "primary" : "text-button";
    button.textContent = action.label;
    button.addEventListener("click", () => action.onClick?.());
    footer.appendChild(button);
  });
  modal.innerHTML = `
    <div class="modal__content" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
      <header class="modal__header">
        <h2>${title}</h2>
        <button class="icon-button" data-action="close" aria-label="Close dialog">✕</button>
      </header>
    </div>
  `;
  modal.querySelector(".modal__content")?.appendChild(bodyContent);
  modal.querySelector(".modal__content")?.appendChild(footer);
  applyFocusTrap(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeDialog();
    }
    const action = event.target.closest("button")?.dataset.action;
    if (action === "close") {
      closeDialog();
    }
  });
  document.body.appendChild(modal);
  activeDialog = modal;
  focusFirstElement(modal);
}

function showConfirm(message, { title = "Confirm" } = {}) {
  return new Promise((resolve) => {
    openDialog({
      title,
      message,
      actions: [
        { label: "Cancel", onClick: () => resolve(false) },
        { label: "Confirm", primary: true, onClick: () => resolve(true) }
      ]
    });
  }).finally(closeDialog);
}

function showChoice(message, { title = "Choose", choices = [] } = {}) {
  return new Promise((resolve) => {
    openDialog({
      title,
      message,
      actions: choices.map((choice) => ({
        label: choice.label,
        primary: choice.primary,
        onClick: () => resolve(choice.value)
      }))
    });
  }).finally(closeDialog);
}

function showPrompt(message, { title = "Prompt", placeholder = "", value = "" } = {}) {
  return new Promise((resolve) => {
    const field = document.createElement("div");
    field.className = "modal__field";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value;
    field.appendChild(input);
    openDialog({
      title,
      message,
      content: field,
      actions: [
        { label: "Cancel", onClick: () => resolve(null) },
        { label: "OK", primary: true, onClick: () => resolve(input.value) }
      ]
    });
    requestAnimationFrame(() => input.focus());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        resolve(input.value);
      }
      if (event.key === "Escape") {
        resolve(null);
      }
    });
  }).finally(closeDialog);
}

function showError(message, { title = "Something went wrong" } = {}) {
  return new Promise((resolve) => {
    openDialog({
      title,
      message,
      actions: [{ label: "OK", primary: true, onClick: () => resolve() }]
    });
  }).finally(closeDialog);
}

function showImportPreview({ entries, conflicts }) {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.className = "import-preview";
    const summary = document.createElement("p");
    summary.className = "import-preview__summary";
    summary.textContent = `This import will add ${entries.length} document${
      entries.length === 1 ? "" : "s"
    }.`;
    container.appendChild(summary);
    const list = document.createElement("div");
    list.className = "import-preview__list";
    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "import-preview__row";
      row.innerHTML = `
        <div class="import-preview__title">${entry.title}</div>
        <div class="import-preview__meta">${entry.type.toUpperCase()}</div>
        <div class="import-preview__status ${entry.statusClass}">${entry.statusLabel}</div>
      `;
      list.appendChild(row);
    });
    container.appendChild(list);
    let conflictStrategy = "copy";
    if (conflicts > 0) {
      const strategy = document.createElement("div");
      strategy.className = "import-preview__strategy";
      strategy.innerHTML = `
        <p>Conflict handling</p>
        <label>
          <input type="radio" name="import-strategy" value="copy" checked />
          Create copies for conflicts
        </label>
        <label>
          <input type="radio" name="import-strategy" value="overwrite" />
          Overwrite existing documents
        </label>
      `;
      strategy.addEventListener("change", (event) => {
        const target = event.target;
        if (target.name === "import-strategy") {
          conflictStrategy = target.value;
        }
      });
      container.appendChild(strategy);
    }
    openDialog({
      title: "Import preview",
      content: container,
      actions: [
        { label: "Cancel", onClick: () => resolve({ action: "cancel" }) },
        {
          label: "Import",
          primary: true,
          onClick: () => resolve({ action: "import", conflictStrategy })
        }
      ]
    });
  }).finally(closeDialog);
}

async function checkCrashRecovery() {
  if (!pendingRecovery || pendingRecovery.clean) {
    pendingRecovery = null;
    return;
  }
  const choice = await showChoice(
    `We detected an unsaved session from ${new Date(
      pendingRecovery.updatedAt
    ).toLocaleString()}. Would you like to restore it?`,
    {
      title: "Restore previous session",
      choices: [
        { label: "Restore", value: "restore", primary: true },
        { label: "Discard", value: "discard" }
      ]
    }
  );
  if (choice === "restore") {
    if (pendingRecovery.lastDocId && workspace.documents[pendingRecovery.lastDocId]) {
      currentDocId = pendingRecovery.lastDocId;
      currentView = pendingRecovery.lastView ?? "library";
    } else {
      currentView = "library";
    }
    renderStatus("Session restored");
    render();
  } else {
    renderStatus("Previous session discarded");
  }
  pendingRecovery = null;
}

function openCreateDocumentDialog(initialType = "writer") {
  if (createDialogState) {
    closeDialog();
  }
  const field = document.createElement("div");
  field.className = "modal__field";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Document name";
  const typeSelect = document.createElement("select");
  typeSelect.innerHTML = `
    <option value="writer">Writer</option>
    <option value="sheets">Sheets</option>
    <option value="slides">Slides</option>
    <option value="base">Base</option>
  `;
  typeSelect.value = initialType;
  const templateSelect = document.createElement("select");
  const templateGrid = document.createElement("div");
  templateGrid.className = "template-grid";
  const renderTemplates = () => {
    const templates = TEMPLATE_CATALOG[typeSelect.value] ?? [];
    templateSelect.innerHTML = templates
      .map((template) => `<option value="${template.id}">${template.label}</option>`)
      .join("");
    if (templates.length && !templates.find((template) => template.id === templateSelect.value)) {
      templateSelect.value = templates[0].id;
    }
    templateGrid.innerHTML = "";
    templates.forEach((template) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "template-card";
      button.dataset.templateId = template.id;
      button.innerHTML = `
        <div class="template-card__title">${template.label}</div>
        <div class="template-card__desc">${template.description}</div>
      `;
      if (template.id === templateSelect.value) {
        button.classList.add("active");
      }
      templateGrid.appendChild(button);
    });
  };
  typeSelect.addEventListener("change", () => {
    renderTemplates();
  });
  templateGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button")?.dataset.templateId;
    if (!button) return;
    templateSelect.value = button;
    renderTemplates();
  });
  renderTemplates();
  field.appendChild(nameInput);
  field.appendChild(typeSelect);
  field.appendChild(templateSelect);
  field.appendChild(templateGrid);

  const handleCreate = () => {
    const appType = typeSelect.value;
    const templateId = templateSelect.value;
    const doc = createDocumentFromTemplate(appType, templateId);
    if (!doc) {
      showError("Unable to create document for the selected app.");
      return;
    }
    doc.meta.title = nameInput.value.trim() || doc.meta.title;
    doc.meta.template = templateId;
    workspace.index = createDocument(workspace.index, doc);
    workspace.documents[doc.id] = doc;
    switchDocument(doc.id);
    renderStatus("Document created");
  };

  openDialog({
    title: "Create new document",
    content: field,
    actions: [
      { label: "Cancel", onClick: closeDialog },
      { label: "Create", primary: true, onClick: handleCreate }
    ]
  });
  createDialogState = { typeSelect, templateSelect, nameInput };
  requestAnimationFrame(() => nameInput.focus());
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleCreate();
    }
  });
}

function showToast(message, { timeout = 2400 } = {}) {
  const container = document.querySelector(".toast-container");
  if (!container) return;
  container.textContent = "";
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span>${message}</span>
    ${message.includes("Undo?") ? '<button class="toast__action" data-action="undo-delete">Undo</button>' : ""}
  `;
  container.appendChild(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("toast--fade");
    setTimeout(() => {
      if (toast.parentElement === container) {
        container.removeChild(toast);
      }
    }, 300);
  }, timeout);
  toast.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (action === "undo-delete" && lastLibraryAction?.type === "delete") {
      const restored = lastLibraryAction.doc;
      const insertAt = Math.min(
        lastLibraryAction.index ?? workspace.index.documents.length,
        workspace.index.documents.length
      );
      workspace.documents[restored.id] = restored;
      workspace.index.documents.splice(insertAt, 0, restored);
      saveWorkspaceIndex(workspace.index);
      saveDocument(restored, { snapshot: true });
      lastLibraryAction = null;
      renderStatus("Document restored");
      render();
    }
  });
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return { highContrast: false, reducedMotion: false, theme: "light" };
  }
  try {
    const parsed = JSON.parse(raw);
    return { theme: "light", highContrast: false, reducedMotion: false, ...parsed };
  } catch (error) {
    return { highContrast: false, reducedMotion: false, theme: "light" };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings() {
  document.body.classList.toggle("theme-dark", settings.theme === "dark");
  document.body.classList.toggle("theme-contrast", settings.highContrast);
  document.body.classList.toggle("reduced-motion", settings.reducedMotion);
}

function createTopBar() {
  const bar = document.createElement("header");
  bar.className = "top-bar";
  bar.innerHTML = `
    <div class="top-bar__left">
      <button class="icon-button" data-action="open-library" aria-label="Open library">☰</button>
      <span class="app-title">Workspot Office Suite</span>
    </div>
    <div class="top-bar__center">
      <input type="search" placeholder="Search documents" aria-label="Search documents" value="${searchQuery}" />
    </div>
    <div class="top-bar__right">
      <button class="text-button" data-action="export">Export</button>
      <button class="text-button" data-action="import">Import</button>
      <button class="text-button" data-action="settings">Settings</button>
      <button class="text-button" data-action="help">Help</button>
    </div>
  `;
  bar.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (!action) return;
    if (action === "open-library") {
      currentView = "library";
      render();
    }
    if (action === "export") {
      handleExport();
    }
    if (action === "import") {
      handleImport();
    }
    if (action === "settings") {
      toggleSettingsModal(true);
    }
    if (action === "help") {
      toggleHelpModal(true);
    }
  });
  bar.querySelector("input")?.addEventListener("input", (event) => {
    searchQuery = event.target.value;
    if (currentView === "library") {
      render();
    }
  });
  return bar;
}

function createLeftRail() {
  const nav = document.createElement("nav");
  nav.className = "left-rail";
  nav.innerHTML = `
    <button data-app="library">Library</button>
    <button data-app="writer">Writer</button>
    <button data-app="sheets">Sheets</button>
    <button data-app="slides">Slides</button>
    <button data-app="base">Base</button>
  `;
  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const app = button.dataset.app;
    if (app === "library") {
      currentView = "library";
      render();
      return;
    }
    const doc = workspace.index.documents.find((entry) => entry.type === app);
    if (doc) {
      switchDocument(doc.id);
    }
  });
  return nav;
}

function createBottomNav() {
  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.innerHTML = `
    <button data-app="library">Library</button>
    <button data-app="writer">Writer</button>
    <button data-app="sheets">Sheets</button>
    <button data-app="slides">Slides</button>
    <button data-app="base">Base</button>
  `;
  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const app = button.dataset.app;
    if (app === "library") {
      currentView = "library";
      render();
      return;
    }
    const doc = workspace.index.documents.find((entry) => entry.type === app);
    if (doc) {
      switchDocument(doc.id);
    }
  });
  return nav;
}

function createStatusBar() {
  const status = document.createElement("footer");
  status.className = "status-bar";
  status.innerHTML = `
    <span class="status-bar__message">Ready</span>
    <span class="status-bar__autosave">Autosave on</span>
    <span class="status-bar__announcer sr-only" role="status" aria-live="polite"></span>
  `;
  return status;
}

function createToastContainer() {
  const container = document.createElement("div");
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("role", "status");
  return container;
}

function renderLibrary() {
  const container = document.createElement("div");
  container.className = "library";
  container.dataset.dropzone = "workspace-import";
  const header = document.createElement("div");
  header.className = "library__header";
  header.innerHTML = `
    <h2>Document Library</h2>
    <div class="library__controls">
      <div class="library__views">
        <button class="text-button" data-view="grid" aria-pressed="${libraryViewMode === "grid"}">Grid</button>
        <button class="text-button" data-view="list" aria-pressed="${libraryViewMode === "list"}">List</button>
      </div>
      <label class="library__sort">
        <span>Sort</span>
        <select data-sort>
          <option value="recent" ${librarySortMode === "recent" ? "selected" : ""}>Recent</option>
          <option value="name" ${librarySortMode === "name" ? "selected" : ""}>Name</option>
          <option value="type" ${librarySortMode === "type" ? "selected" : ""}>Type</option>
        </select>
      </label>
    </div>
    <div class="library__actions">
      <button class="primary" data-create="writer">New Writer Doc</button>
      <button class="primary" data-create="sheets">New Sheets Workbook</button>
      <button class="primary" data-create="slides">New Slides Deck</button>
      <button class="primary" data-create="base">New Base Database</button>
    </div>
  `;
  container.appendChild(header);

  const list = document.createElement("div");
  list.className = `library__list library__list--${libraryViewMode}`;
  const filtered = workspace.index.documents.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const sorted = filtered.slice().sort((a, b) => {
    if (librarySortMode === "name") {
      return a.title.localeCompare(b.title);
    }
    if (librarySortMode === "type") {
      return a.type.localeCompare(b.type);
    }
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
  const pinnedIds = workspace.index.pinnedIds ?? [];
  const pinnedDocs = sorted.filter((doc) => pinnedIds.includes(doc.id));
  const unpinnedDocs = sorted.filter((doc) => !pinnedIds.includes(doc.id));
  const recentDocs = unpinnedDocs.slice(0, 5);

  const renderCard = (doc) => {
    const card = document.createElement("div");
    card.className = "library__card";
    card.dataset.docId = doc.id;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="library__card-title">${doc.title}</div>
      <div class="library__card-meta">${doc.type.toUpperCase()}</div>
      <div class="library__card-meta">Updated ${new Date(doc.updatedAt).toLocaleString()}</div>
      <div class="library__card-actions">
        <button class="pin-button" data-pin="${doc.id}" aria-pressed="${pinnedIds.includes(doc.id)}">
        ${pinnedIds.includes(doc.id) ? "Unpin" : "Pin"}
        </button>
        <button class="icon-button" data-menu="${doc.id}" aria-label="Document actions">⋯</button>
      </div>
    `;
    return card;
  };

  if (pinnedDocs.length) {
    const pinnedSection = document.createElement("div");
    pinnedSection.className = "library__section";
    pinnedSection.innerHTML = `<h3>Pinned</h3>`;
    const pinnedList = document.createElement("div");
    pinnedList.className = `library__list library__list--${libraryViewMode}`;
    pinnedDocs.forEach((doc) => pinnedList.appendChild(renderCard(doc)));
    pinnedSection.appendChild(pinnedList);
    container.appendChild(pinnedSection);
  }

  const recentSection = document.createElement("div");
  recentSection.className = "library__section";
  recentSection.innerHTML = `<h3>Recent</h3>`;
  recentDocs.forEach((doc) => list.appendChild(renderCard(doc)));
  recentSection.appendChild(list);
  container.appendChild(recentSection);

  const meta = document.createElement("p");
  meta.className = "library__meta";
  meta.textContent = `${sorted.length} document(s) shown`;
  container.appendChild(meta);

  container.addEventListener("click", (event) => {
    const create = event.target.closest("button")?.dataset.create;
    if (create) {
      openCreateDocumentDialog(create);
      return;
    }
    const pin = event.target.closest("button")?.dataset.pin;
    if (pin) {
      event.stopPropagation();
      const nextPinned = new Set(workspace.index.pinnedIds ?? []);
      if (nextPinned.has(pin)) {
        nextPinned.delete(pin);
      } else {
        nextPinned.add(pin);
      }
      workspace.index.pinnedIds = Array.from(nextPinned);
      saveWorkspaceIndex(workspace.index);
      render();
      return;
    }
    const menu = event.target.closest("button")?.dataset.menu;
    if (menu) {
      event.stopPropagation();
      openDocumentActions(menu);
      return;
    }
    const card = event.target.closest(".library__card")?.dataset.docId;
    if (card) {
      switchDocument(card);
    }
    const view = event.target.closest("button")?.dataset.view;
    if (view) {
      libraryViewMode = view;
      render();
    }
  });
  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".library__card")?.dataset.docId;
    if (card) {
      event.preventDefault();
      switchDocument(card);
    }
  });
  container.addEventListener("change", (event) => {
    const sort = event.target.closest("select")?.dataset.sort;
    if (!sort) return;
    librarySortMode = event.target.value;
    render();
  });

  container.addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".library__card")?.dataset.docId;
    if (!card) return;
    event.preventDefault();
    const doc = workspace.documents[card];
    if (!doc) return;
    const isPinned = (workspace.index.pinnedIds ?? []).includes(card);
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: "Open",
          onSelect: () => switchDocument(card)
        },
        {
          label: isPinned ? "Unpin" : "Pin",
          onSelect: () => {
            const nextPinned = new Set(workspace.index.pinnedIds ?? []);
            if (nextPinned.has(card)) {
              nextPinned.delete(card);
            } else {
              nextPinned.add(card);
            }
            workspace.index.pinnedIds = Array.from(nextPinned);
            saveWorkspaceIndex(workspace.index);
            render();
          }
        },
        { type: "divider" },
        {
          label: "Export summary",
          onSelect: () => openExportSummary(doc)
        },
        {
          label: "Rename",
          onSelect: async () => {
            const nextName = await showPrompt("Rename document", {
              title: "Rename",
              value: doc.meta.title
            });
            if (nextName && nextName.trim()) {
              doc.meta.title = nextName.trim();
              updateMeta(doc);
              saveDocument(doc, { snapshot: true });
              workspace.index = updateDocumentIndex(workspace.index, doc);
              renderStatus("Document renamed");
              render();
            }
          }
        },
        {
          label: "Duplicate",
          onSelect: () => {
            const copy = createDocumentCopy(doc, { suffix: "Copy", switchTo: false });
            if (!copy) return;
            renderStatus("Document duplicated");
            render();
          }
        },
        {
          label: "Delete",
          onSelect: async () => {
            const confirmed = await showConfirm(`Delete "${doc.meta.title}"?`, {
              title: "Delete document"
            });
            if (!confirmed) return;
            const index = workspace.index.documents.findIndex((entry) => entry.id === card);
            if (index === -1) return;
            const [removed] = workspace.index.documents.splice(index, 1);
            delete workspace.documents[card];
            workspace.index.pinnedIds = (workspace.index.pinnedIds ?? []).filter(
              (id) => id !== card
            );
            saveWorkspaceIndex(workspace.index);
            lastLibraryAction = { type: "delete", doc: removed, index };
            renderStatus("Document deleted");
            render();
            showToast("Document deleted. Undo?", { timeout: 5000 });
          }
        }
      ]
    });
  });

  container.addEventListener("dragover", (event) => {
    event.preventDefault();
    container.classList.add("library--dragging");
  });

  container.addEventListener("dragleave", (event) => {
    if (event.target === container) {
      container.classList.remove("library--dragging");
    }
  });

  container.addEventListener("drop", (event) => {
    event.preventDefault();
    container.classList.remove("library--dragging");
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await processWorkspaceImport(reader.result);
    };
    reader.readAsText(file);
  });

  return container;
}

function openDocumentActions(docId) {
  const doc = workspace.documents[docId];
  if (!doc) return;
  const actions = document.createElement("div");
  actions.className = "doc-actions";
  actions.setAttribute("role", "menu");
  actions.setAttribute("aria-label", "Document actions");
  actions.innerHTML = `
    <button role="menuitem" data-action="export">Export summary</button>
    <button role="menuitem" data-action="rename">Rename</button>
    <button role="menuitem" data-action="duplicate">Duplicate</button>
    <button role="menuitem" class="danger" data-action="delete">Delete</button>
  `;
  actions.addEventListener("click", async (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (!action) return;
    if (action === "export") {
      openExportSummary(doc);
      closeDialog();
      return;
    }
    if (action === "rename") {
      const nextName = await showPrompt("Rename document", {
        title: "Rename",
        value: doc.meta.title
      });
      if (nextName && nextName.trim()) {
        doc.meta.title = nextName.trim();
        updateMeta(doc);
        saveDocument(doc, { snapshot: true });
        workspace.index = updateDocumentIndex(workspace.index, doc);
        renderStatus("Document renamed");
        render();
      }
      closeDialog();
    }
    if (action === "duplicate") {
      const copy = createDocumentCopy(doc, { suffix: "Copy", switchTo: false });
      if (!copy) return;
      renderStatus("Document duplicated");
      render();
      closeDialog();
    }
    if (action === "delete") {
      const confirmed = await showConfirm(`Delete "${doc.meta.title}"?`, {
        title: "Delete document"
      });
      if (!confirmed) return;
      const index = workspace.index.documents.findIndex((entry) => entry.id === docId);
      if (index === -1) return;
      const [removed] = workspace.index.documents.splice(index, 1);
      delete workspace.documents[docId];
      workspace.index.pinnedIds = (workspace.index.pinnedIds ?? []).filter((id) => id !== docId);
      saveWorkspaceIndex(workspace.index);
      lastLibraryAction = { type: "delete", doc: removed, index };
      renderStatus("Document deleted");
      render();
      showToast("Document deleted. Undo?", { timeout: 5000 });
      closeDialog();
    }
  });
  openDialog({
    title: "Document actions",
    content: actions,
    actions: [{ label: "Close", onClick: closeDialog }]
  });
}

function openExportSummary(doc) {
  const container = document.createElement("div");
  container.className = "export-summary";
  const preview = document.createElement("div");
  preview.className = "export-summary__preview";
  preview.innerHTML = `
    <span class="export-summary__badge">${doc.type.toUpperCase()}</span>
    <span class="export-summary__title">${doc.meta.title}</span>
  `;
  const details = document.createElement("div");
  details.className = "export-summary__details";
  details.innerHTML = `
    <div>
      <span>Type</span>
      <strong>${doc.type}</strong>
    </div>
    <div>
      <span>Created</span>
      <strong>${new Date(doc.meta.createdAt).toLocaleString()}</strong>
    </div>
    <div>
      <span>Updated</span>
      <strong>${new Date(doc.meta.updatedAt).toLocaleString()}</strong>
    </div>
    <div>
      <span>Template</span>
      <strong>${doc.meta.template ?? "Blank"}</strong>
    </div>
  `;
  container.appendChild(preview);
  container.appendChild(details);
  openDialog({
    title: "Export summary",
    content: container,
    actions: [
      {
        label: "Export workspace",
        primary: true,
        onClick: () => {
          closeDialog();
          handleExport();
        }
      },
      { label: "Close", onClick: closeDialog }
    ]
  });
}

function createSettingsModal() {
  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.dataset.modal = "settings";
  modal.innerHTML = `
    <div class="modal__content" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
      <header class="modal__header">
        <h2>Settings</h2>
        <button class="icon-button" data-action="close" aria-label="Close settings">✕</button>
      </header>
      <div class="modal__body">
        <label class="toggle">
          <span>Theme</span>
          <select data-setting="theme" aria-label="Theme">
            <option value="light" ${settings.theme === "light" ? "selected" : ""}>Light</option>
            <option value="dark" ${settings.theme === "dark" ? "selected" : ""}>Dark</option>
          </select>
        </label>
        <label class="toggle">
          <input type="checkbox" data-setting="highContrast" ${settings.highContrast ? "checked" : ""} />
          <span>High contrast mode</span>
        </label>
        <label class="toggle">
          <input type="checkbox" data-setting="reducedMotion" ${settings.reducedMotion ? "checked" : ""} />
          <span>Reduced motion</span>
        </label>
        <div class="settings-section">
          <h3>Storage</h3>
          <div class="settings-row">
            <span>Workspace usage</span>
            <strong data-storage-usage>--</strong>
          </div>
          <div class="settings-actions">
            <button class="text-button" data-action="export-all">Export all data</button>
            <button class="text-button" data-action="clear-cache">Clear cache</button>
          </div>
        </div>
      </div>
    </div>
  `;
  applyFocusTrap(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      toggleSettingsModal(false);
    }
    const action = event.target.closest("button")?.dataset.action;
    if (action === "close") {
      toggleSettingsModal(false);
    }
    if (action === "export-all") {
      handleExportAllData();
    }
    if (action === "clear-cache") {
      handleClearCache();
    }
  });
  modal.addEventListener("change", (event) => {
    const target = event.target;
    const setting = target.closest("[data-setting]")?.dataset.setting;
    if (!setting) return;
    if (target.type === "checkbox") {
      settings[setting] = target.checked;
    } else {
      settings[setting] = target.value;
    }
    saveSettings();
    applySettings();
    renderStatus("Settings updated");
  });
  return modal;
}

function buildShortcutSections() {
  const appType =
    currentView === "editor" ? workspace.documents[currentDocId]?.type : null;
  const entries = shortcutRegistry.list(appType);
  const grouped = entries.reduce(
    (acc, entry) => {
      const scopeLabel =
        entry.scope === "global"
          ? "Global"
          : `${entry.scope.charAt(0).toUpperCase()}${entry.scope.slice(1)}`;
      acc[scopeLabel] = acc[scopeLabel] ?? [];
      acc[scopeLabel].push(entry);
      return acc;
    },
    {}
  );
  const conflicts = shortcutRegistry.getConflicts();
  return { grouped, conflicts };
}

function renderShortcutList(container) {
  const { grouped, conflicts } = buildShortcutSections();
  const sections = Object.entries(grouped)
    .map(([label, entries]) => {
      const rows = entries
        .map(
          (entry) => `
            <div class="shortcut-row">
              <span class="shortcut-keys">${entry.keys}</span>
              <span class="shortcut-action">${entry.description}</span>
            </div>
          `
        )
        .join("");
      return `
        <div class="shortcut-section" role="list">
          <h3>${label}</h3>
          ${rows}
        </div>
      `;
    })
    .join("");
  const warning = conflicts.length
    ? `<p class="shortcut-conflicts" role="alert">Warning: ${conflicts.length} shortcut conflict(s) detected.</p>`
    : "";
  container.innerHTML = `
    ${warning}
    ${sections}
  `;
}

function createHelpModal() {
  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.dataset.modal = "help";
  modal.innerHTML = `
    <div class="modal__content" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1">
      <header class="modal__header">
        <h2>Keyboard shortcuts</h2>
        <button class="icon-button" data-action="close" aria-label="Close shortcuts">✕</button>
      </header>
      <div class="modal__body">
        <p class="shortcut-intro">Use these shortcuts to move faster around Workspot.</p>
        <div class="shortcut-grid" role="list"></div>
      </div>
    </div>
  `;
  renderShortcutList(modal.querySelector(".shortcut-grid"));
  applyFocusTrap(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      toggleHelpModal(false);
    }
    const action = event.target.closest("button")?.dataset.action;
    if (action === "close") {
      toggleHelpModal(false);
    }
  });
  return modal;
}

function toggleModal(modalName, open) {
  const modal = document.querySelector(`.modal[data-modal="${modalName}"]`);
  if (!modal) return;
  modal.classList.toggle("hidden", !open);
  if (open) {
    if (modalName === "help") {
      renderShortcutList(modal.querySelector(".shortcut-grid"));
    }
    focusFirstElement(modal);
  }
}

function toggleSettingsModal(open) {
  toggleModal("settings", open);
  if (open) {
    refreshStorageUsage();
  }
}

function toggleHelpModal(open) {
  toggleModal("help", open);
}

function renderEditor() {
  const doc = appState.currentDoc();
  if (!doc) {
    return renderLibrary();
  }
  const container = document.createElement("div");
  container.className = "editor";
  const history = getHistory(doc);
  const appHeader = document.createElement("div");
  appHeader.className = "editor__header";
  appHeader.innerHTML = `
    <input class="doc-title" value="${doc.meta.title}" aria-label="Document title" />
    <div class="editor__header-actions">
      <button class="text-button" data-action="undo">Undo</button>
      <button class="text-button" data-action="redo">Redo</button>
    </div>
  `;
  appHeader.addEventListener("input", (event) => {
    if (event.target.classList.contains("doc-title")) {
      doc.meta.title = event.target.value;
      scheduleAutosave(doc);
    }
  });
  appHeader.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (!action) return;
    if (action === "undo") {
      history?.undo((snapshot) => {
        workspace.documents[doc.id] = snapshot;
        renderStatus("Undo");
        render();
      });
    }
    if (action === "redo") {
      history?.redo((snapshot) => {
        workspace.documents[doc.id] = snapshot;
        renderStatus("Redo");
        render();
      });
    }
  });
  container.appendChild(appHeader);

  const renderer = appRenderers[doc.type];
  if (renderer) {
    const appSurface = renderer({
      doc,
      registry,
      onChange: (options) => {
        scheduleAutosave(doc);
        history?.record(options);
      },
      onStatus: renderStatus,
      onAnnounce: renderAnnouncement,
      dialogs: {
        confirm: showConfirm,
        prompt: showPrompt,
        error: showError
      }
    });
    container.appendChild(appSurface);
  }
  return container;
}

function handleExport() {
  const data = exportWorkspace(workspace.index, workspace.documents);
  const textarea = document.createElement("textarea");
  textarea.className = "export-textarea";
  textarea.value = data;
  const content = document.createElement("div");
  content.className = "export-panel";
  const helper = document.createElement("p");
  helper.className = "export-helper";
  helper.textContent = "Download the JSON file or copy it to your clipboard.";
  content.appendChild(helper);
  content.appendChild(textarea);
  openDialog({
    title: "Export workspace",
    content,
    actions: [
      {
        label: "Copy to clipboard",
        primary: true,
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(data);
            renderStatus("Workspace copied to clipboard");
            closeDialog();
          } catch (error) {
            textarea.select();
            document.execCommand("copy");
            renderStatus("Workspace copied to clipboard");
            closeDialog();
          }
        }
      },
      {
        label: "Download JSON",
        onClick: () => {
          const blob = new Blob([data], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "workspot-workspace.json";
          anchor.click();
          URL.revokeObjectURL(url);
          renderStatus("Workspace exported");
          closeDialog();
        }
      },
      { label: "Close", onClick: closeDialog }
    ]
  });
}

function handleExportAllData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    workspace: {
      index: workspace.index,
      documents: workspace.documents
    },
    settings
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "workspot-all-data.json";
  anchor.click();
  URL.revokeObjectURL(url);
  renderStatus("All data exported");
}

async function handleClearCache() {
  const confirmed = await showConfirm(
    "This will clear cached workspace data stored on this device. Settings will be kept.",
    { title: "Clear workspace cache" }
  );
  if (!confirmed) return;
  clearWorkspaceStorage();
  renderStatus("Workspace cache cleared");
  localStorage.removeItem(SESSION_KEY);
  window.location.reload();
}

async function handleConcurrentEdit() {
  if (concurrentEditPrompted) return;
  concurrentEditPrompted = true;
  const choice = await showChoice(
    "Another tab has updated this workspace. Choose how to continue.",
    {
      title: "Concurrent edit detected",
      choices: [
        { label: "Reload", value: "reload", primary: true },
        { label: "Fork current doc", value: "fork" },
        { label: "Dismiss", value: "dismiss" }
      ]
    }
  );
  if (choice === "reload") {
    const loaded = loadWorkspace();
    workspace.index = loaded.index;
    workspace.documents = loaded.documents;
    if (!workspace.documents[currentDocId]) {
      currentDocId = workspace.index.documents[0]?.id ?? null;
      currentView = "library";
    }
    renderStatus("Workspace reloaded");
    render();
  }
  if (choice === "fork") {
    const doc = workspace.documents[currentDocId];
    if (doc) {
      createDocumentCopy(doc, { suffix: "Fork", switchTo: true });
      renderStatus("Forked current document");
      render();
    }
  }
  concurrentEditPrompted = false;
}

async function processWorkspaceImport(payload) {
  try {
    const analysis = analyzeWorkspaceImport(payload, workspace);
    const entries = Object.values(analysis.parsed.documents).map((doc) => {
      const isConflict = Boolean(workspace.documents[doc.id]);
      return {
        id: doc.id,
        title: doc.meta?.title ?? doc.id,
        type: doc.type,
        statusLabel: isConflict ? "Conflict" : "New",
        statusClass: isConflict ? "import-preview__status--conflict" : "import-preview__status--new"
      };
    });
    const preview = await showImportPreview({ entries, conflicts: analysis.conflicts });
    if (preview.action !== "import") {
      renderStatus("Import canceled");
      return;
    }
    const parsed = importWorkspace(analysis.parsed, workspace, {
      conflictStrategy: preview.conflictStrategy
    });
    workspace.index = parsed.index;
    workspace.documents = parsed.documents;
    currentView = "library";
    if (analysis.conflicts > 0) {
      renderStatus(
        `Workspace imported (${analysis.conflicts} conflict${
          analysis.conflicts === 1 ? "" : "s"
        } resolved)`
      );
    } else {
      renderStatus("Workspace imported");
    }
    render();
  } catch (error) {
    renderStatus("Import failed: invalid file");
    showError("The selected file could not be imported. Please check the file format.");
  }
}

function handleImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await processWorkspaceImport(reader.result);
    };
    reader.readAsText(file);
  });
  input.click();
}

function registerSharedCommands() {
  registry.register({
    id: "app.library",
    label: "Open Library",
    icon: "📚",
    category: "Navigation",
    shortcut: "Ctrl/Cmd + Shift + L",
    handler: () => {
      currentView = "library";
      render();
    }
  });
  registry.register({
    id: "app.export",
    label: "Export Workspace",
    icon: "⬇️",
    category: "File",
    shortcut: "Ctrl/Cmd + Shift + E",
    handler: handleExport
  });
  registry.register({
    id: "app.import",
    label: "Import Workspace",
    icon: "⬆️",
    category: "File",
    shortcut: "Ctrl/Cmd + Shift + I",
    handler: handleImport
  });
  registry.register({
    id: "app.help",
    label: "Open Shortcuts Help",
    icon: "❓",
    shortcut: "?",
    category: "Help",
    handler: () => toggleHelpModal(true)
  });
}

function registerShortcuts({ palette }) {
  shortcutRegistry.register({
    id: "global.palette",
    keys: "Ctrl/Cmd + K",
    description: "Open command palette",
    scope: "global",
    action: () => {
      if (palette) {
        const isHidden = document
          .querySelector(".command-palette")
          ?.classList.contains("hidden");
        if (isHidden) {
          palette.showPalette();
        } else {
          palette.hidePalette();
        }
      }
    }
  });
  shortcutRegistry.register({
    id: "global.help",
    keys: "?",
    description: "Open shortcuts help",
    scope: "global",
    action: () => toggleHelpModal(true)
  });
  shortcutRegistry.register({
    id: "global.library",
    keys: "Ctrl/Cmd + Shift + L",
    description: "Open library",
    scope: "global",
    action: () => {
      currentView = "library";
      render();
    }
  });
  shortcutRegistry.register({
    id: "global.settings",
    keys: "Ctrl/Cmd + ,",
    description: "Open settings",
    scope: "global",
    action: () => toggleSettingsModal(true)
  });
  shortcutRegistry.register({
    id: "global.escape",
    keys: "Escape",
    description: "Close modals or command palette",
    scope: "global",
    action: () => {
      toggleHelpModal(false);
      toggleSettingsModal(false);
      closeDialog();
      closeContextMenu();
      palette?.hidePalette();
    }
  });

  shortcutRegistry.register({
    id: "writer.bold",
    keys: "Ctrl/Cmd + B",
    description: "Writer: Bold",
    scope: "writer",
    action: () => registry.get("writer.bold")?.handler?.()
  });
  shortcutRegistry.register({
    id: "writer.italic",
    keys: "Ctrl/Cmd + I",
    description: "Writer: Italic",
    scope: "writer",
    action: () => registry.get("writer.italic")?.handler?.()
  });
  shortcutRegistry.register({
    id: "writer.underline",
    keys: "Ctrl/Cmd + U",
    description: "Writer: Underline",
    scope: "writer",
    action: () => registry.get("writer.underline")?.handler?.()
  });

  shortcutRegistry.register({
    id: "sheets.addRow",
    keys: "Ctrl/Cmd + Shift + R",
    description: "Sheets: Add row",
    scope: "sheets",
    action: () => registry.get("sheets.addRow")?.handler?.()
  });
  shortcutRegistry.register({
    id: "sheets.addCol",
    keys: "Ctrl/Cmd + Shift + C",
    description: "Sheets: Add column",
    scope: "sheets",
    action: () => registry.get("sheets.addCol")?.handler?.()
  });
  shortcutRegistry.register({
    id: "sheets.autosum",
    keys: "Ctrl/Cmd + Shift + S",
    description: "Sheets: AutoSum help",
    scope: "sheets",
    action: () => registry.get("sheets.autosum")?.handler?.()
  });

  shortcutRegistry.register({
    id: "slides.newSlide",
    keys: "Ctrl/Cmd + M",
    description: "Slides: New slide",
    scope: "slides",
    action: () => registry.get("slides.addSlide")?.handler?.()
  });
  shortcutRegistry.register({
    id: "slides.textBox",
    keys: "Ctrl/Cmd + Shift + T",
    description: "Slides: Add text box",
    scope: "slides",
    action: () => registry.get("slides.addText")?.handler?.()
  });
  shortcutRegistry.register({
    id: "slides.theme",
    keys: "Ctrl/Cmd + Shift + Y",
    description: "Slides: Toggle theme",
    scope: "slides",
    action: () => registry.get("slides.toggleTheme")?.handler?.()
  });

  shortcutRegistry.register({
    id: "base.addTable",
    keys: "Ctrl/Cmd + Shift + N",
    description: "Base: New table",
    scope: "base",
    action: () => registry.get("base.addTable")?.handler?.()
  });
  shortcutRegistry.register({
    id: "base.addField",
    keys: "Ctrl/Cmd + Shift + F",
    description: "Base: Add field",
    scope: "base",
    action: () => registry.get("base.addField")?.handler?.()
  });
  shortcutRegistry.register({
    id: "base.addRecord",
    keys: "Ctrl/Cmd + Shift + R",
    description: "Base: Add record",
    scope: "base",
    action: () => registry.get("base.addRecord")?.handler?.()
  });
}

function render() {
  root.innerHTML = "";
  closeContextMenu();
  const appShell = document.createElement("div");
  appShell.className = "app-shell";
  appShell.appendChild(createTopBar());
  const main = document.createElement("div");
  main.className = "main";
  main.appendChild(createLeftRail());
  const content = document.createElement("main");
  content.className = "content";
  content.appendChild(currentView === "library" ? renderLibrary() : renderEditor());
  main.appendChild(content);
  appShell.appendChild(main);
  appShell.appendChild(createStatusBar());
  appShell.appendChild(createBottomNav());
  appShell.appendChild(createToastContainer());
  root.appendChild(appShell);
  if (!document.querySelector('.modal[data-modal="settings"]')) {
    document.body.appendChild(createSettingsModal());
  }
  if (!document.querySelector('.modal[data-modal="help"]')) {
    document.body.appendChild(createHelpModal());
  }
  refreshStorageUsage();
  updateSessionState({ clean: false });
}

registerSharedCommands();
applySettings();
const palette = createCommandPalette(document.body, registry, (id) => {
  const command = registry.get(id);
  if (command?.handler) {
    command.handler();
  }
}, { enableGlobalShortcuts: false });
registerShortcuts({ palette });
document.addEventListener("keydown", (event) => {
  const appType =
    currentView === "editor" ? workspace.documents[currentDocId]?.type : null;
  if (isTextInput(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key !== "Escape") return;
  }
  const match = shortcutRegistry.findMatch(event, appType);
  if (match) {
    event.preventDefault();
    match.action?.();
  }
});
render();
checkCrashRecovery();
window.addEventListener("beforeunload", markSessionClean);
window.addEventListener("storage", (event) => {
  if (!event.key || !isWorkspaceStorageKey(event.key)) return;
  handleConcurrentEdit();
});
