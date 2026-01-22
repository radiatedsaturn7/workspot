import { updateMeta } from "../data.js";
import { attachTouchSelectionHandles } from "../a11y.js";

function createToolbar(onCommand) {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar toolbar--touch";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Writer toolbar");
  toolbar.innerHTML = `
    <button data-cmd="heading1">H1</button>
    <button data-cmd="heading2">H2</button>
    <label class="toolbar__field">
      <span class="sr-only">Font size</span>
      <select data-cmd="fontSize" aria-label="Font size">
        <option value="2">Small</option>
        <option value="3" selected>Normal</option>
        <option value="5">Large</option>
        <option value="6">XL</option>
      </select>
    </label>
    <label class="toolbar__field">
      <span class="sr-only">Font color</span>
      <input type="color" data-cmd="fontColor" aria-label="Font color" value="#0f172a" />
    </label>
    <button data-cmd="bold"><strong>B</strong></button>
    <button data-cmd="italic"><em>I</em></button>
    <button data-cmd="underline"><span class="underline">U</span></button>
    <button data-cmd="blockquote">Quote</button>
    <button data-cmd="indent">Indent</button>
    <button data-cmd="outdent">Outdent</button>
    <button data-cmd="inlineCode">Code</button>
    <button data-cmd="highlight">Highlight</button>
    <button data-cmd="clearFormatting">Clear</button>
    <button data-cmd="tableHeader">Header Row</button>
    <button data-cmd="tableZebra">Zebra</button>
    <button data-cmd="tableBorders">Borders</button>
    <button data-cmd="find">Find</button>
    <button data-cmd="findNext">Next</button>
    <button data-cmd="findPrev">Prev</button>
    <button data-cmd="clearFind">Clear Find</button>
    <button data-cmd="spellcheck">Spellcheck</button>
    <button data-cmd="exportPdf">Export PDF</button>
    <button data-cmd="alignLeft">Left</button>
    <button data-cmd="alignCenter">Center</button>
    <button data-cmd="alignRight">Right</button>
    <button data-cmd="bulletList">Bullets</button>
    <button data-cmd="numberList">Numbered</button>
    <button data-cmd="insertTable">Table</button>
    <button data-cmd="insertImage">Image</button>
    <button data-cmd="insertLink">Link</button>
    <button data-cmd="findReplace">Find/Replace</button>
    <button data-cmd="addComment">Comment</button>
  `;
  toolbar.addEventListener("click", async (event) => {
    const cmd = event.target.closest("button")?.dataset.cmd;
    if (cmd) await onCommand(cmd);
  });
  toolbar.addEventListener("change", async (event) => {
    const target = event.target.closest("[data-cmd]");
    const cmd = target?.dataset.cmd;
    if (!cmd) return;
    await onCommand(cmd, target.value);
  });
  return toolbar;
}

function serializeContent(contentEditable) {
  const text = contentEditable.innerText.replace(/\u00a0/g, " ");
  return text.split(/\n/).filter(Boolean).map((line) => ({
    block: "paragraph",
    style: "Normal",
    runs: [{ text: line, marks: [] }]
  }));
}

function renderContent(doc) {
  const container = document.createElement("div");
  container.className = "writer__content";
  container.contentEditable = "true";
  container.setAttribute("role", "textbox");
  container.setAttribute("aria-multiline", "true");
  container.innerHTML = doc.content
    .map((block) => {
      if (block.block === "heading") {
        const level = block.level ?? 1;
        return `<h${level}>${block.runs.map((run) => run.text).join("")}</h${level}>`;
      }
      return `<p>${block.runs.map((run) => run.text).join("")}</p>`;
    })
    .join("");
  return container;
}

export function createWriterApp({ doc, registry, onChange, onStatus, onAnnounce, dialogs }) {
  const container = document.createElement("section");
  container.className = "writer";
  const announce = onAnnounce ?? onStatus ?? (() => {});
  const promptDialog = dialogs?.prompt ?? window.prompt;
  const toolbar = createToolbar(handleCommand);
  const canvas = renderContent(doc);
  const comments = document.createElement("aside");
  comments.className = "writer__comments";
  comments.innerHTML = `
    <h3>Comments</h3>
    <ul></ul>
    <div class="writer__spellcheck">
      <div class="writer__spellcheck-header">
        <h4>Spellcheck</h4>
        <span data-spellcheck-status>Off</span>
      </div>
      <ul class="writer__spellcheck-list"></ul>
    </div>
    <div class="writer__stats">
      <div>
        <strong data-word-count>0</strong>
        <span>Words</span>
      </div>
      <div>
        <strong data-reading-time>0 min</strong>
        <span>Reading time</span>
      </div>
    </div>
  `;

  container.appendChild(toolbar);
  const body = document.createElement("div");
  body.className = "writer__body";
  body.appendChild(canvas);
  body.appendChild(comments);
  container.appendChild(body);

  const updateContent = () => {
    doc.content = serializeContent(canvas);
    updateMeta(doc);
    onChange();
  };

  let lastStats = { words: 0, minutes: 0 };
  let findQuery = "";
  let findMatches = [];
  let findIndex = -1;
  let spellcheckEnabled = false;

  const updateStats = () => {
    const text = canvas.innerText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const minutes = words ? Math.max(1, Math.ceil(words / 200)) : 0;
    if (words === lastStats.words && minutes === lastStats.minutes) return;
    lastStats = { words, minutes };
    const wordCount = comments.querySelector("[data-word-count]");
    const readingTime = comments.querySelector("[data-reading-time]");
    if (wordCount) wordCount.textContent = String(words);
    if (readingTime) {
      readingTime.textContent = minutes ? `${minutes} min` : "0 min";
    }
  };

  const handles = attachTouchSelectionHandles({
    container,
    getRect: () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!canvas.contains(range.startContainer)) return null;
      return range.getBoundingClientRect();
    },
    onAdjust: (point, handle) => {
      const selection = document.getSelection();
      if (!selection) return;
      const caretRange = document.caretRangeFromPoint?.(point.x, point.y);
      const caretPosition = document.caretPositionFromPoint?.(point.x, point.y);
      const range = caretRange ?? (caretPosition
        ? (() => {
            const created = document.createRange();
            created.setStart(caretPosition.offsetNode, caretPosition.offset);
            created.collapse(true);
            return created;
          })()
        : null);
      if (!range) return;
      const activeRange = selection.rangeCount ? selection.getRangeAt(0) : null;
      if (range.startContainer && !canvas.contains(range.startContainer)) return;
      if (!activeRange) {
        selection.removeAllRanges();
        selection.addRange(range.cloneRange ? range : range);
        return;
      }
      const nextRange = activeRange.cloneRange();
      if (handle === "start") {
        nextRange.setStart(range.startContainer, range.startOffset);
      } else {
        nextRange.setEnd(range.startContainer, range.startOffset);
      }
      selection.removeAllRanges();
      selection.addRange(nextRange);
    }
  });

  canvas.addEventListener("input", updateContent);
  canvas.addEventListener("input", () => {
    if (findQuery) {
      applyFindHighlights(findQuery);
    }
    runSpellcheckScan();
    updateStats();
  });
  updateStats();
  let lastAnnouncement = "";
  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    if (!anchor || !canvas.contains(anchor)) return;
    const text = selection.toString();
    const announcement = text
      ? `Selected text (${text.length} characters).`
      : "Cursor moved in document.";
    if (announcement !== lastAnnouncement) {
      announce(announcement);
      lastAnnouncement = announcement;
    }
    handles.setActive(Boolean(selection && selection.rangeCount && canvas.contains(anchor)));
  });
  canvas.addEventListener("focusin", () => handles.setActive(true));
  canvas.addEventListener("focusout", () => handles.setActive(false));

  const applyFontSize = (size) => {
    if (!size) return;
    document.execCommand("fontSize", false, size);
  };

  const applyFontColor = (color) => {
    if (!color) return;
    document.execCommand("foreColor", false, color);
  };

  const applyInlineCode = () => {
    const selection = document.getSelection();
    const text = selection?.toString() ?? "";
    if (!text) {
      onStatus("Select text to apply inline code.");
      return;
    }
    document.execCommand(
      "insertHTML",
      false,
      `<code class="writer__inline-code">${text}</code>`
    );
  };

  const applyHighlight = () => {
    const selection = document.getSelection();
    const text = selection?.toString() ?? "";
    if (!text) {
      onStatus("Select text to highlight.");
      return;
    }
    document.execCommand(
      "insertHTML",
      false,
      `<mark class="writer__highlight">${text}</mark>`
    );
  };

  const clearFormatting = () => {
    document.execCommand("removeFormat");
  };

  const getActiveTable = () => {
    const selection = document.getSelection();
    if (!selection) return null;
    const anchorNode = selection.anchorNode;
    return anchorNode?.parentElement?.closest("table");
  };

  const toggleTableClass = (className) => {
    const table = getActiveTable();
    if (!table) {
      onStatus("Select a table first.");
      return;
    }
    table.classList.toggle(className);
  };

  const clearFindHighlights = () => {
    canvas.querySelectorAll(".writer__find-match").forEach((node) => {
      const parent = node.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(node.textContent), node);
      parent.normalize();
    });
    findMatches = [];
    findIndex = -1;
  };

  const applyFindHighlights = (query) => {
    clearFindHighlights();
    if (!query) return;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (regex.test(node.nodeValue)) {
        targets.push(node);
      }
    }
    targets.forEach((textNode) => {
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      const text = textNode.nodeValue;
      text.replace(regex, (match, offset) => {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
        const span = document.createElement("span");
        span.className = "writer__find-match";
        span.textContent = match;
        fragment.appendChild(span);
        lastIndex = offset + match.length;
        return match;
      });
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      textNode.parentNode?.replaceChild(fragment, textNode);
    });
    findMatches = Array.from(canvas.querySelectorAll(".writer__find-match"));
    if (findMatches.length) {
      findIndex = 0;
      findMatches[0].classList.add("writer__find-active");
      findMatches[0].scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      findIndex = -1;
    }
  };

  const focusFindMatch = (index) => {
    if (!findMatches.length) return;
    findMatches.forEach((match) => match.classList.remove("writer__find-active"));
    const nextIndex = (index + findMatches.length) % findMatches.length;
    findIndex = nextIndex;
    const active = findMatches[nextIndex];
    active.classList.add("writer__find-active");
    active.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const runSpellcheckScan = () => {
    if (!spellcheckEnabled) return;
    const dictionary = [
      "a",
      "about",
      "and",
      "are",
      "be",
      "can",
      "comment",
      "content",
      "document",
      "edit",
      "format",
      "highlight",
      "inline",
      "link",
      "list",
      "note",
      "paragraph",
      "table",
      "text",
      "the",
      "this",
      "to",
      "writer",
      "with"
    ];
    const words = canvas.innerText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const unique = Array.from(new Set(words));
    const misspellings = unique.filter((word) => !dictionary.includes(word) && word.length > 2);
    const list = comments.querySelector(".writer__spellcheck-list");
    list.innerHTML = "";
    misspellings.slice(0, 8).forEach((word) => {
      const suggestion = dictionary.find((entry) => entry.startsWith(word[0])) || "—";
      const item = document.createElement("li");
      item.innerHTML = `
        <span class="writer__spellcheck-word">${word}</span>
        <button data-spellcheck-word="${word}" data-spellcheck-suggestion="${suggestion}">
          Suggest: ${suggestion}
        </button>
      `;
      list.appendChild(item);
    });
  };

  const exportToPdf = () => {
    const header = document.createElement("div");
    header.className = "print-header";
    header.innerHTML = `
      <h1>${doc.meta.title}</h1>
      <p>Exported ${new Date().toLocaleString()}</p>
    `;
    document.body.appendChild(header);
    window.print();
    header.remove();
  };

  const applyLinkStyle = () => {
    const selection = document.getSelection();
    if (!selection) return;
    const anchorNode = selection.anchorNode;
    const anchor = anchorNode?.parentElement?.closest("a");
    if (anchor) {
      anchor.classList.add("writer__link");
    }
  };

  const openLinkEditor = async () => {
    const selection = document.getSelection();
    const selectedText = selection?.toString() ?? "";
    const url = await promptDialog("Enter URL", { title: "Insert link" });
    if (!url) return;
    if (!selectedText) {
      const text = await promptDialog("Link text", {
        title: "Insert link",
        value: url
      });
      if (!text) return;
      document.execCommand("insertText", false, text);
    }
    document.execCommand("createLink", false, url);
    applyLinkStyle();
  };

  async function handleCommand(command, value) {
    if (command === "heading1") {
      document.execCommand("formatBlock", false, "h1");
    }
    if (command === "heading2") {
      document.execCommand("formatBlock", false, "h2");
    }
    if (command === "fontSize") {
      applyFontSize(value);
    }
    if (command === "fontColor") {
      applyFontColor(value);
    }
    if (command === "bold") {
      document.execCommand("bold");
    }
    if (command === "italic") {
      document.execCommand("italic");
    }
    if (command === "underline") {
      document.execCommand("underline");
    }
    if (command === "blockquote") {
      document.execCommand("formatBlock", false, "blockquote");
    }
    if (command === "indent") {
      document.execCommand("indent");
    }
    if (command === "outdent") {
      document.execCommand("outdent");
    }
    if (command === "inlineCode") {
      applyInlineCode();
    }
    if (command === "highlight") {
      applyHighlight();
    }
    if (command === "clearFormatting") {
      clearFormatting();
    }
    if (command === "tableHeader") {
      toggleTableClass("writer__table--header");
    }
    if (command === "tableZebra") {
      toggleTableClass("writer__table--zebra");
    }
    if (command === "tableBorders") {
      toggleTableClass("writer__table--borders");
    }
    if (command === "find") {
      const query = await promptDialog("Find text", { title: "Find" });
      if (!query) return;
      findQuery = query;
      applyFindHighlights(findQuery);
      onStatus(findMatches.length ? `${findMatches.length} match(es)` : "No matches");
    }
    if (command === "findNext") {
      if (!findMatches.length) {
        onStatus("No matches. Run find first.");
        return;
      }
      focusFindMatch(findIndex + 1);
    }
    if (command === "findPrev") {
      if (!findMatches.length) {
        onStatus("No matches. Run find first.");
        return;
      }
      focusFindMatch(findIndex - 1);
    }
    if (command === "clearFind") {
      clearFindHighlights();
      findQuery = "";
      onStatus("Find cleared");
    }
    if (command === "spellcheck") {
      spellcheckEnabled = !spellcheckEnabled;
      canvas.spellcheck = spellcheckEnabled;
      const status = comments.querySelector("[data-spellcheck-status]");
      status.textContent = spellcheckEnabled ? "On" : "Off";
      onStatus(spellcheckEnabled ? "Spellcheck enabled" : "Spellcheck disabled");
      runSpellcheckScan();
    }
    if (command === "exportPdf") {
      exportToPdf();
    }
    if (command === "alignLeft") {
      document.execCommand("justifyLeft");
    }
    if (command === "alignCenter") {
      document.execCommand("justifyCenter");
    }
    if (command === "alignRight") {
      document.execCommand("justifyRight");
    }
    if (command === "bulletList") {
      document.execCommand("insertUnorderedList");
    }
    if (command === "numberList") {
      document.execCommand("insertOrderedList");
    }
    if (command === "insertTable") {
      const table = document.createElement("table");
      table.className = "writer__table writer__table--borders";
      table.innerHTML = `<tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr>`;
      canvas.appendChild(table);
      updateContent();
    }
    if (command === "insertImage") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = document.createElement("img");
          img.src = reader.result;
          img.alt = "Inserted image";
          img.style.maxWidth = "100%";
          canvas.appendChild(img);
          updateContent();
        };
        reader.readAsDataURL(file);
      });
      input.click();
    }
    if (command === "insertLink") {
      await openLinkEditor();
      updateContent();
    }
    if (command === "findReplace") {
      const query = await promptDialog("Find text", { title: "Find and replace" });
      if (!query) return;
      const replacement = await promptDialog("Replace with", {
        title: "Find and replace",
        value: ""
      });
      if (replacement !== null) {
        canvas.innerHTML = canvas.innerHTML.split(query).join(replacement);
        updateContent();
      }
    }
    if (command === "addComment") {
      const selection = document.getSelection();
      const text = selection?.toString();
      if (!text) {
        onStatus("Select text to comment");
        return;
      }
      const commentText = await promptDialog("Comment", { title: "Add comment" });
      if (!commentText) return;
      const comment = {
        id: crypto.randomUUID(),
        text: commentText,
        anchor: text,
        createdAt: new Date().toISOString()
      };
      doc.comments.push(comment);
      renderComments();
      updateContent();
    }
    if (
      [
        "heading1",
        "heading2",
        "fontSize",
        "fontColor",
        "bold",
        "italic",
        "underline",
        "blockquote",
        "indent",
        "outdent",
        "inlineCode",
        "highlight",
        "clearFormatting",
        "tableHeader",
        "tableZebra",
        "tableBorders",
        "find",
        "findNext",
        "findPrev",
        "clearFind",
        "spellcheck",
        "exportPdf",
        "alignLeft",
        "alignCenter",
        "alignRight",
        "bulletList",
        "numberList"
      ].includes(command)
    ) {
      updateContent();
    }
  }

  function renderComments() {
    const list = comments.querySelector("ul");
    list.innerHTML = "";
    doc.comments.forEach((comment) => {
      comment.replies = comment.replies ?? [];
      const item = document.createElement("li");
      item.className = "writer__comment";
      item.innerHTML = `
        <div class="writer__comment-body">
          <strong>${comment.anchor}:</strong> ${comment.text}
        </div>
        <div class="writer__comment-actions">
          <button data-comment-action="reply" data-comment-id="${comment.id}">Reply</button>
        </div>
        <ul class="writer__comment-replies"></ul>
      `;
      const repliesList = item.querySelector(".writer__comment-replies");
      comment.replies.forEach((reply) => {
        const replyItem = document.createElement("li");
        replyItem.textContent = reply.text;
        repliesList.appendChild(replyItem);
      });
      list.appendChild(item);
    });
  }

  renderComments();

  comments.addEventListener("click", async (event) => {
    const commentAction = event.target.closest("button")?.dataset.commentAction;
    if (commentAction === "reply") {
      const id = event.target.closest("button")?.dataset.commentId;
      const comment = doc.comments.find((entry) => entry.id === id);
      if (!comment) return;
      const replyText = await promptDialog("Reply", { title: "Reply to comment" });
      if (!replyText) return;
      comment.replies = comment.replies ?? [];
      comment.replies.push({
        id: crypto.randomUUID(),
        text: replyText,
        createdAt: new Date().toISOString()
      });
      updateContent();
      renderComments();
      return;
    }
    const suggestion = event.target.closest("button")?.dataset.spellcheckSuggestion;
    const word = event.target.closest("button")?.dataset.spellcheckWord;
    if (!suggestion || !word || suggestion === "—") return;
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    canvas.innerHTML = canvas.innerHTML.replace(pattern, suggestion);
    updateContent();
    runSpellcheckScan();
  });

  registry.register({
    id: "writer.heading1",
    label: "Writer: Heading 1",
    handler: () => handleCommand("heading1")
  });
  registry.register({
    id: "writer.heading2",
    label: "Writer: Heading 2",
    handler: () => handleCommand("heading2")
  });
  registry.register({
    id: "writer.fontSizeSmall",
    label: "Writer: Font Size Small",
    handler: () => handleCommand("fontSize", "2")
  });
  registry.register({
    id: "writer.fontSizeNormal",
    label: "Writer: Font Size Normal",
    handler: () => handleCommand("fontSize", "3")
  });
  registry.register({
    id: "writer.fontSizeLarge",
    label: "Writer: Font Size Large",
    handler: () => handleCommand("fontSize", "5")
  });
  registry.register({
    id: "writer.fontColor",
    label: "Writer: Font Color",
    handler: async () => {
      const color = await promptDialog("Font color (hex)", {
        title: "Font color",
        value: "#0f172a"
      });
      if (color) {
        applyFontColor(color);
        updateContent();
      }
    }
  });
  registry.register({
    id: "writer.blockquote",
    label: "Writer: Blockquote",
    handler: () => handleCommand("blockquote")
  });
  registry.register({
    id: "writer.indent",
    label: "Writer: Indent",
    handler: () => handleCommand("indent")
  });
  registry.register({
    id: "writer.outdent",
    label: "Writer: Outdent",
    handler: () => handleCommand("outdent")
  });
  registry.register({
    id: "writer.inlineCode",
    label: "Writer: Inline Code",
    handler: () => handleCommand("inlineCode")
  });
  registry.register({
    id: "writer.highlight",
    label: "Writer: Highlight",
    handler: () => handleCommand("highlight")
  });
  registry.register({
    id: "writer.clearFormatting",
    label: "Writer: Clear Formatting",
    handler: () => handleCommand("clearFormatting")
  });
  registry.register({
    id: "writer.tableHeader",
    label: "Writer: Toggle Table Header Row",
    handler: () => handleCommand("tableHeader")
  });
  registry.register({
    id: "writer.tableZebra",
    label: "Writer: Toggle Table Zebra",
    handler: () => handleCommand("tableZebra")
  });
  registry.register({
    id: "writer.tableBorders",
    label: "Writer: Toggle Table Borders",
    handler: () => handleCommand("tableBorders")
  });
  registry.register({
    id: "writer.find",
    label: "Writer: Find",
    handler: () => handleCommand("find")
  });
  registry.register({
    id: "writer.findNext",
    label: "Writer: Find Next",
    handler: () => handleCommand("findNext")
  });
  registry.register({
    id: "writer.findPrev",
    label: "Writer: Find Previous",
    handler: () => handleCommand("findPrev")
  });
  registry.register({
    id: "writer.clearFind",
    label: "Writer: Clear Find",
    handler: () => handleCommand("clearFind")
  });
  registry.register({
    id: "writer.spellcheck",
    label: "Writer: Toggle Spellcheck",
    handler: () => handleCommand("spellcheck")
  });
  registry.register({
    id: "writer.exportPdf",
    label: "Writer: Export PDF",
    handler: () => handleCommand("exportPdf")
  });
  registry.register({
    id: "writer.bold",
    label: "Writer: Bold",
    handler: () => handleCommand("bold")
  });
  registry.register({
    id: "writer.italic",
    label: "Writer: Italic",
    handler: () => handleCommand("italic")
  });
  registry.register({
    id: "writer.underline",
    label: "Writer: Underline",
    handler: () => handleCommand("underline")
  });
  registry.register({
    id: "writer.alignLeft",
    label: "Writer: Align Left",
    handler: () => handleCommand("alignLeft")
  });
  registry.register({
    id: "writer.alignCenter",
    label: "Writer: Align Center",
    handler: () => handleCommand("alignCenter")
  });
  registry.register({
    id: "writer.alignRight",
    label: "Writer: Align Right",
    handler: () => handleCommand("alignRight")
  });
  registry.register({
    id: "writer.bulletList",
    label: "Writer: Bullet List",
    handler: () => handleCommand("bulletList")
  });
  registry.register({
    id: "writer.numberList",
    label: "Writer: Numbered List",
    handler: () => handleCommand("numberList")
  });

  return container;
}
