import { updateMeta } from "../data.js";
import { DEFAULT_TEMPLATES } from "../data.js";
import { attachTouchSelectionHandles } from "../a11y.js";

export function createSlidesApp({ doc, registry, onChange, onAnnounce }) {
  const container = document.createElement("section");
  container.className = "slides";
  const announce = onAnnounce ?? (() => {});

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar toolbar--touch";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Slides toolbar");
  toolbar.innerHTML = `
    <button data-cmd="addSlide">New Slide</button>
    <button data-cmd="addText">Text Box</button>
    <button data-cmd="theme">Toggle Theme</button>
    <button data-cmd="templates">Templates</button>
    <button data-cmd="palette">Theme Palette</button>
  `;
  container.appendChild(toolbar);

  let currentSlideIndex = 0;
  const templates = DEFAULT_TEMPLATES.slides ?? [];
  const themePalette = doc.meta.themePalette ?? {
    background: "#ffffff",
    text: "#0f172a",
    accent: "#3b82f6"
  };
  const transitionOptions = [
    { id: "None", label: "None" },
    { id: "Fade", label: "Fade" },
    { id: "Slide", label: "Slide" },
    { id: "Zoom", label: "Zoom" },
    { id: "Flip", label: "Flip" }
  ];
  const sidebar = document.createElement("div");
  sidebar.className = "slides__sidebar";
  const canvas = document.createElement("div");
  canvas.className = "slides__canvas";
  const stage = document.createElement("div");
  stage.className = "slides__stage";
  canvas.appendChild(stage);

  const notesPanel = document.createElement("section");
  notesPanel.className = "slides__notes";
  notesPanel.innerHTML = `
    <header class="slides__notes-header">
      <div>
        <h3>Presenter notes</h3>
        <p class="slides__notes-meta"></p>
      </div>
      <span class="slides__notes-count" aria-live="polite"></span>
    </header>
    <textarea
      class="slides__notes-input"
      rows="5"
      placeholder="Add presenter notes for this slide"
    ></textarea>
    <div class="slides__transition">
      <div class="slides__transition-head">
        <h4>Slide transition</h4>
        <span class="slides__transition-preview"></span>
      </div>
      <label class="slides__transition-field">
        Style
        <select class="slides__transition-select"></select>
      </label>
      <label class="slides__transition-field">
        Duration
        <span class="slides__transition-duration-value"></span>
        <input
          class="slides__transition-duration"
          type="range"
          min="0.1"
          max="3"
          step="0.1"
        />
      </label>
    </div>
  `;
  const notesMeta = notesPanel.querySelector(".slides__notes-meta");
  const notesCount = notesPanel.querySelector(".slides__notes-count");
  const notesInput = notesPanel.querySelector(".slides__notes-input");
  const transitionSelect = notesPanel.querySelector(".slides__transition-select");
  const transitionDuration = notesPanel.querySelector(".slides__transition-duration");
  const transitionDurationValue = notesPanel.querySelector(".slides__transition-duration-value");
  const transitionPreview = notesPanel.querySelector(".slides__transition-preview");

  transitionOptions.forEach((option) => {
    const optionNode = document.createElement("option");
    optionNode.value = option.id;
    optionNode.textContent = option.label;
    transitionSelect.appendChild(optionNode);
  });

  const main = document.createElement("div");
  main.className = "slides__main";
  main.appendChild(canvas);
  main.appendChild(notesPanel);

  const layout = document.createElement("div");
  layout.className = "slides__layout";
  layout.appendChild(sidebar);
  layout.appendChild(main);
  container.appendChild(layout);

  let activeElement = null;
  const handles = attachTouchSelectionHandles({
    container,
    getRect: () => activeElement?.getBoundingClientRect() ?? null,
    onAdjust: (point) => {
      const next = document.elementFromPoint(point.x, point.y)?.closest(".slides__element");
      if (next) {
        next.focus();
      }
    }
  });

  const addSlide = () => {
    doc.slides.push({
      id: `slide_${crypto.randomUUID()}`,
      title: `Slide ${doc.slides.length + 1}`,
      elements: [],
      notes: "",
      transition: {
        type: "None",
        duration: 0.6
      }
    });
    currentSlideIndex = doc.slides.length - 1;
    updateMeta(doc);
    onChange();
    renderSlidesList();
    renderSlide();
    announce(`Added slide ${currentSlideIndex + 1}.`);
  };

  const addText = () => {
    const slide = doc.slides[currentSlideIndex];
    slide.elements.push({
      id: `el_${crypto.randomUUID()}`,
      type: "text",
      x: 80,
      y: 120,
      w: 300,
      h: 60,
      text: "New text",
      style: { fontSize: 24 }
    });
    updateMeta(doc);
    onChange();
    renderSlide();
    announce(`Added text box on slide ${currentSlideIndex + 1}.`);
  };

  const toggleTheme = () => {
    doc.meta.theme = doc.meta.theme === "Light" ? "Dark" : "Light";
    container.dataset.theme = doc.meta.theme;
  };

  const applyPalette = () => {
    const palette = doc.meta.themePalette ?? themePalette;
    stage.style.background = palette.background;
    stage.style.color = palette.text;
    stage.style.setProperty("--slides-accent", palette.accent);
  };

  const openTemplates = () => {
    const panel = document.createElement("div");
    panel.className = "slides__templates";
    panel.innerHTML = `
      <h3>Slide templates</h3>
      <div class="slides__template-grid"></div>
    `;
    const grid = panel.querySelector(".slides__template-grid");
    templates.forEach((template) => {
      const button = document.createElement("button");
      button.className = "slides__template-card";
      button.innerHTML = `
        <strong>${template.name}</strong>
        <span>${template.summary}</span>
      `;
      button.addEventListener("click", () => {
        const slide = doc.slides[currentSlideIndex];
        if (!slide) return;
        slide.elements = template.elements.map((element) => ({
          ...element,
          id: `el_${crypto.randomUUID()}`
        }));
        slide.title = template.name;
        updateMeta(doc);
        onChange();
        renderSlide();
        renderSlidesList();
      });
      grid.appendChild(button);
    });
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.dataset.modal = "slides-templates";
    modal.innerHTML = `
      <div class="modal__content" role="dialog" aria-modal="true" aria-label="Slide templates">
        <header class="modal__header">
          <h2>Slide templates</h2>
          <button class="icon-button" data-action="close" aria-label="Close templates">✕</button>
        </header>
      </div>
    `;
    modal.querySelector(".modal__content").appendChild(panel);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.remove();
      if (event.target.closest("button")?.dataset.action === "close") modal.remove();
    });
    document.body.appendChild(modal);
    modal.querySelector("button")?.focus();
  };

  const openPalette = () => {
    const panel = document.createElement("div");
    panel.className = "slides__palette";
    panel.innerHTML = `
      <label>
        Background
        <input type="color" data-palette="background" value="${themePalette.background}" />
      </label>
      <label>
        Text
        <input type="color" data-palette="text" value="${themePalette.text}" />
      </label>
      <label>
        Accent
        <input type="color" data-palette="accent" value="${themePalette.accent}" />
      </label>
    `;
    panel.addEventListener("input", (event) => {
      const field = event.target.closest("input")?.dataset.palette;
      if (!field) return;
      themePalette[field] = event.target.value;
      doc.meta.themePalette = { ...themePalette };
      applyPalette();
      updateMeta(doc);
      onChange();
    });
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.dataset.modal = "slides-palette";
    modal.innerHTML = `
      <div class="modal__content" role="dialog" aria-modal="true" aria-label="Theme palette">
        <header class="modal__header">
          <h2>Theme palette</h2>
          <button class="icon-button" data-action="close" aria-label="Close palette">✕</button>
        </header>
      </div>
    `;
    modal.querySelector(".modal__content").appendChild(panel);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.remove();
      if (event.target.closest("button")?.dataset.action === "close") modal.remove();
    });
    document.body.appendChild(modal);
    modal.querySelector("button")?.focus();
  };

  function renderSlidesList() {
    sidebar.innerHTML = "";
    doc.slides.forEach((slide, index) => {
      const thumb = document.createElement("button");
      thumb.className = "slides__thumb";
      thumb.textContent = slide.title ?? `Slide ${index + 1}`;
      thumb.dataset.index = index;
      if (index === currentSlideIndex) {
        thumb.classList.add("active");
      }
      sidebar.appendChild(thumb);
    });
  }

  const ensureTransition = (slide) => {
    if (!slide.transition) {
      slide.transition = { type: "None", duration: 0.6 };
    }
    return slide.transition;
  };

  const updateTransitionUI = (transition) => {
    transitionSelect.value = transition.type;
    transitionDuration.value = String(transition.duration);
    transitionDurationValue.textContent = `${transition.duration.toFixed(1)}s`;
    transitionPreview.textContent =
      transition.type === "None"
        ? "No transition"
        : `${transition.type} · ${transition.duration.toFixed(1)}s`;
  };

  function renderSlide() {
    stage.innerHTML = "";
    const slide = doc.slides[currentSlideIndex];
    if (!slide) {
      notesMeta.textContent = "";
      notesCount.textContent = "";
      notesInput.value = "";
      notesInput.disabled = true;
      transitionSelect.disabled = true;
      transitionDuration.disabled = true;
      transitionDurationValue.textContent = "";
      transitionPreview.textContent = "";
      return;
    }
    applyPalette();
    notesInput.disabled = false;
    notesInput.value = slide.notes ?? "";
    notesMeta.textContent = `Slide ${currentSlideIndex + 1} · ${slide.title ?? "Untitled"}`;
    notesCount.textContent = `${notesInput.value.length} characters`;
    transitionSelect.disabled = false;
    transitionDuration.disabled = false;
    const transition = ensureTransition(slide);
    updateTransitionUI(transition);
    const badge = document.createElement("div");
    badge.className = "slides__transition-badge";
    badge.textContent =
      transition.type === "None"
        ? "No transition"
        : `${transition.type} · ${transition.duration.toFixed(1)}s`;
    stage.appendChild(badge);
    slide.elements.forEach((element) => {
      const node = document.createElement("div");
      node.className = "slides__element";
      node.contentEditable = "true";
      node.tabIndex = 0;
      node.style.left = `${element.x}px`;
      node.style.top = `${element.y}px`;
      node.style.width = `${element.w}px`;
      node.style.height = `${element.h}px`;
      node.style.fontSize = `${element.style.fontSize}px`;
      node.style.fontWeight = element.style.bold ? "700" : "400";
      node.textContent = element.text;
      node.addEventListener("focus", () => {
        announce(`Selected text element on slide ${currentSlideIndex + 1}.`);
        activeElement = node;
        handles.setActive(true);
      });
      node.addEventListener("blur", () => {
        if (activeElement === node) {
          activeElement = null;
          handles.setActive(false);
        }
      });
      node.addEventListener("input", () => {
        element.text = node.textContent;
        updateMeta(doc);
        onChange();
      });
      stage.appendChild(node);
    });
  }

  sidebar.addEventListener("click", (event) => {
    const index = event.target.closest("button")?.dataset.index;
    if (index === undefined) return;
    currentSlideIndex = Number(index);
    renderSlidesList();
    renderSlide();
    announce(`Selected slide ${currentSlideIndex + 1}.`);
  });

  notesInput.addEventListener("input", () => {
    const slide = doc.slides[currentSlideIndex];
    if (!slide) return;
    slide.notes = notesInput.value;
    notesCount.textContent = `${notesInput.value.length} characters`;
    updateMeta(doc);
    onChange();
  });

  transitionSelect.addEventListener("change", () => {
    const slide = doc.slides[currentSlideIndex];
    if (!slide) return;
    const transition = ensureTransition(slide);
    transition.type = transitionSelect.value;
    updateTransitionUI(transition);
    updateMeta(doc);
    onChange();
    renderSlide();
  });

  transitionDuration.addEventListener("input", () => {
    const slide = doc.slides[currentSlideIndex];
    if (!slide) return;
    const transition = ensureTransition(slide);
    transition.duration = Number(transitionDuration.value);
    updateTransitionUI(transition);
    updateMeta(doc);
    onChange();
    renderSlide();
  });

  toolbar.addEventListener("click", (event) => {
    const cmd = event.target.closest("button")?.dataset.cmd;
    if (!cmd) return;
    if (cmd === "addSlide") {
      addSlide();
    }
    if (cmd === "addText") {
      addText();
    }
    if (cmd === "theme") {
      toggleTheme();
    }
    if (cmd === "templates") {
      openTemplates();
    }
    if (cmd === "palette") {
      openPalette();
    }
  });

  registry.register({
    id: "slides.addSlide",
    label: "Slides: New Slide",
    handler: addSlide
  });
  registry.register({
    id: "slides.addText",
    label: "Slides: Add Text",
    handler: addText
  });
  registry.register({
    id: "slides.toggleTheme",
    label: "Slides: Toggle Theme",
    handler: toggleTheme
  });
  registry.register({
    id: "slides.templates",
    label: "Slides: Open Templates",
    handler: openTemplates
  });
  registry.register({
    id: "slides.palette",
    label: "Slides: Theme Palette",
    handler: openPalette
  });

  container.dataset.theme = doc.meta.theme;
  renderSlidesList();
  renderSlide();
  return container;
}
