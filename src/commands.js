export class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.listeners = new Set();
  }

  register(command) {
    this.commands.set(command.id, command);
    this.notify();
  }

  unregister(id) {
    this.commands.delete(id);
    this.notify();
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.commands);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(id) {
    return this.commands.get(id);
  }

  list(filter) {
    return Array.from(this.commands.values()).filter(filter ?? (() => true));
  }

  isEnabled(command) {
    if (typeof command?.enabled === "function") {
      return command.enabled();
    }
    if (typeof command?.enabled === "boolean") {
      return command.enabled;
    }
    return true;
  }
}

export function createCommandPalette(container, registry, onExecute, options = {}) {
  const { enableGlobalShortcuts = true } = options;
  const palette = document.createElement("div");
  palette.className = "command-palette hidden";
  palette.innerHTML = `
    <div class="command-palette__header">
      <input type="text" placeholder="Type a command" aria-label="Command palette" />
    </div>
    <div class="command-palette__filters" role="tablist" aria-label="Command categories"></div>
    <ul class="command-palette__list" role="listbox"></ul>
  `;
  container.appendChild(palette);

  const input = palette.querySelector("input");
  const filters = palette.querySelector(".command-palette__filters");
  const list = palette.querySelector("ul");
  let commands = registry.list();
  let activeIndex = 0;
  let visibleCommands = commands;
  let activeCategory = "All";

  const getCategory = (command) => command.category ?? "General";
  const getCategories = () => {
    const categories = new Set(["All"]);
    commands.forEach((cmd) => categories.add(getCategory(cmd)));
    return Array.from(categories);
  };

  const nextEnabledIndex = (items, startIndex, delta) => {
    if (!items.length) return -1;
    let index = startIndex;
    for (let step = 0; step < items.length; step += 1) {
      index = (index + delta + items.length) % items.length;
      if (registry.isEnabled(items[index])) return index;
    }
    return -1;
  };

  const fuzzyScore = (query, target) => {
    if (!query) return 0;
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let score = 0;
    let tIndex = 0;
    for (let i = 0; i < q.length; i += 1) {
      const char = q[i];
      const found = t.indexOf(char, tIndex);
      if (found === -1) return -1;
      score += found === tIndex ? 2 : 1;
      tIndex = found + 1;
    }
    return score;
  };

  const renderFilters = () => {
    const categories = getCategories();
    filters.innerHTML = "";
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "command-palette__filter";
      button.dataset.category = category;
      button.textContent = category;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(category === activeCategory));
      if (category === activeCategory) {
        button.classList.add("active");
      }
      filters.appendChild(button);
    });
  };

  const render = (query = "") => {
    list.innerHTML = "";
    const filtered = commands.filter((cmd) =>
      activeCategory === "All" ? true : getCategory(cmd) === activeCategory
    );
    const withScores = filtered
      .map((cmd) => ({
        cmd,
        score: fuzzyScore(query, cmd.label)
      }))
      .filter((item) => item.score >= 0);
    withScores.sort((a, b) => b.score - a.score);
    visibleCommands = withScores.map((item) => item.cmd);
    if (!visibleCommands.length) {
      const empty = document.createElement("li");
      empty.className = "command-palette__empty";
      empty.textContent = "No commands found.";
      list.appendChild(empty);
      return;
    }
    if (!registry.isEnabled(visibleCommands[activeIndex])) {
      const firstEnabled = nextEnabledIndex(visibleCommands, -1, 1);
      activeIndex = firstEnabled === -1 ? 0 : firstEnabled;
    }
    visibleCommands.forEach((cmd, index) => {
      const li = document.createElement("li");
      li.className = "command-palette__item";
      li.setAttribute("role", "option");
      li.dataset.commandId = cmd.id;
      li.tabIndex = index === activeIndex ? 0 : -1;
      if (index === activeIndex) {
        li.classList.add("active");
      }
      const enabled = registry.isEnabled(cmd);
      li.setAttribute("aria-disabled", String(!enabled));
      if (!enabled) {
        li.classList.add("disabled");
      }
      li.innerHTML = `
        <span class="command-palette__label">
          ${cmd.icon ? `<span class="command-palette__icon">${cmd.icon}</span>` : ""}
          ${cmd.label}
        </span>
        ${cmd.shortcut ? `<span class="command-palette__shortcut">${cmd.shortcut}</span>` : ""}
      `;
      list.appendChild(li);
    });
  };

  const refresh = () => {
    commands = registry.list();
    activeIndex = 0;
    renderFilters();
    render(input.value);
  };

  registry.subscribe(refresh);

  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const categories = getCategories();
      const currentIndex = categories.indexOf(activeCategory);
      const nextIndex = event.shiftKey
        ? (currentIndex - 1 + categories.length) % categories.length
        : (currentIndex + 1) % categories.length;
      activeCategory = categories[nextIndex];
      activeIndex = 0;
      renderFilters();
      render(input.value);
    }
  });
  input.addEventListener("keydown", (event) => {
    const options = Array.from(list.querySelectorAll("li"));
    if (!options.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = nextEnabledIndex(visibleCommands, activeIndex, 1);
      if (activeIndex === -1) return;
      render(input.value);
      options[activeIndex]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = nextEnabledIndex(visibleCommands, activeIndex, -1);
      if (activeIndex === -1) return;
      render(input.value);
      options[activeIndex]?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = options[activeIndex];
      if (selected && selected.getAttribute("aria-disabled") !== "true") {
        onExecute(selected.dataset.commandId);
        hidePalette();
      }
    }
  });
  list.addEventListener("click", (event) => {
    const target = event.target.closest("li");
    if (!target) return;
    if (target.getAttribute("aria-disabled") === "true") return;
    onExecute(target.dataset.commandId);
    hidePalette();
  });
  filters.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    activeCategory = target.dataset.category;
    activeIndex = 0;
    renderFilters();
    render(input.value);
  });

  const showPalette = () => {
    palette.classList.remove("hidden");
    input.value = "";
    refresh();
    input.focus();
  };

  const hidePalette = () => {
    palette.classList.add("hidden");
  };

  if (enableGlobalShortcuts) {
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (palette.classList.contains("hidden")) {
          showPalette();
        } else {
          hidePalette();
        }
      }
      if (event.key === "Escape" && !palette.classList.contains("hidden")) {
        hidePalette();
      }
    });
  }

  return { showPalette, hidePalette };
}
