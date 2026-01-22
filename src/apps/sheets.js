import { updateMeta } from "../data.js";
import { attachTouchSelectionHandles } from "../a11y.js";

const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function cellKey(colIndex, rowIndex) {
  return `${COLS[colIndex]}${rowIndex + 1}`;
}

function keyToCoords(key) {
  const match = key.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = COLS.indexOf(match[1]);
  const row = Number(match[2]) - 1;
  if (col < 0 || row < 0) return null;
  return { row, col };
}

function isWithinRange(coords, start, end) {
  if (!coords || !start || !end) return false;
  const rowMin = Math.min(start.row, end.row);
  const rowMax = Math.max(start.row, end.row);
  const colMin = Math.min(start.col, end.col);
  const colMax = Math.max(start.col, end.col);
  return (
    coords.row >= rowMin &&
    coords.row <= rowMax &&
    coords.col >= colMin &&
    coords.col <= colMax
  );
}

function evaluateFormula(formula, cells) {
  if (!formula.startsWith("=")) return formula;
  const expression = formula.slice(1).replace(/[A-Z]+\d+/g, (match) => {
    const value = cells[match]?.v ?? 0;
    return Number.isFinite(Number(value)) ? value : `"${value}"`;
  });
  try {
    return Function(`"use strict"; return (${expression});`)();
  } catch (error) {
    return "#ERR";
  }
}

export function createSheetsApp({ doc, registry, onChange, onAnnounce }) {
  const container = document.createElement("section");
  container.className = "sheets";
  const announce = onAnnounce ?? (() => {});
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar toolbar--touch";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Sheets toolbar");
  toolbar.innerHTML = `
    <button data-cmd="freezeRow">Freeze Row</button>
    <button data-cmd="freezeCol">Freeze Column</button>
    <button data-cmd="addRow">Add Row</button>
    <button data-cmd="addCol">Add Column</button>
    <button data-cmd="toggleChart">Chart</button>
    <button data-cmd="validation">Validation</button>
    <button data-cmd="toggleFilter">Filter Row</button>
    <button data-cmd="sortAsc">Sort A→Z</button>
    <button data-cmd="sortDesc">Sort Z→A</button>
    <label class="toolbar__field">
      <span class="sr-only">Format</span>
      <select data-cmd="formatType" aria-label="Format type">
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="currency">Currency</option>
        <option value="date">Date</option>
      </select>
    </label>
    <label class="toolbar__field">
      <span class="sr-only">Conditional format</span>
      <select data-cmd="conditionalPreset" aria-label="Conditional format">
        <option value="">Conditional format</option>
        <option value="heat">Heatmap</option>
        <option value="positive">Positive/Negative</option>
      </select>
    </label>
    <label class="toolbar__field">
      <span class="sr-only">Decimal places</span>
      <select data-cmd="formatDecimals" aria-label="Decimal places">
        <option value="0">0</option>
        <option value="1">1</option>
        <option value="2" selected>2</option>
        <option value="3">3</option>
      </select>
    </label>
    <button data-cmd="formatBold"><strong>B</strong></button>
    <button data-cmd="sum">AutoSum</button>
  `;
  container.appendChild(toolbar);

  const grid = document.createElement("div");
  grid.className = "sheets__grid";
  const sheet = doc.sheets[0];
  const rows = sheet.grid.rows;
  const cols = sheet.grid.cols;
  sheet.view = sheet.view ?? { freezeRow: false, freezeCol: false };
  sheet.formats = sheet.formats ?? {};
  sheet.validations = sheet.validations ?? {};
  sheet.filters = sheet.filters ?? {};
  sheet.rowOrder = sheet.rowOrder ?? Array.from({ length: rows }, (_, idx) => idx);
  sheet.conditionals = sheet.conditionals ?? {};
  let activeCellKey = null;
  let selection = null;
  let isSelecting = false;
  let fillDrag = null;
  let chartState = sheet.chartState ?? { open: false, type: "bar", range: "A1:A5" };

  const formatValue = (raw, format) => {
    const value = raw ?? "";
    if (!format || format.type === "text") return value;
    if (format.type === "number") {
      const num = Number(value);
      if (Number.isNaN(num)) return value;
      return num.toFixed(format.decimals ?? 2);
    }
    if (format.type === "currency") {
      const num = Number(value);
      if (Number.isNaN(num)) return value;
      return `$${num.toFixed(format.decimals ?? 2)}`;
    }
    if (format.type === "date") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleDateString();
    }
    return value;
  };

  const addRow = () => {
    sheet.grid.rows += 1;
    onChange();
    location.reload();
  };

  const addCol = () => {
    sheet.grid.cols += 1;
    onChange();
    location.reload();
  };

  const autoSum = () => {
    onChange();
    alert("Select a range and use =SUM(A1:A5) in a cell.");
  };

  const toggleFreezeRow = () => {
    sheet.view.freezeRow = !sheet.view.freezeRow;
    onChange();
    renderGrid();
  };

  const toggleFreezeCol = () => {
    sheet.view.freezeCol = !sheet.view.freezeCol;
    onChange();
    renderGrid();
  };

  const applyFormatToActive = (format) => {
    if (!activeCellKey) {
      announce("Select a cell to format.");
      return;
    }
    sheet.formats[activeCellKey] = { ...format };
    onChange();
    renderGrid();
  };

  const toggleChart = () => {
    chartState.open = !chartState.open;
    sheet.chartState = chartState;
    onChange();
    renderChart();
  };

  const applyValidation = async () => {
    if (!activeCellKey) {
      announce("Select a cell to validate.");
      return;
    }
    const options = prompt("Validation options (comma separated)", "High,Medium,Low");
    if (!options) return;
    sheet.validations[activeCellKey] = options
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    onChange();
    renderGrid();
  };

  const toggleFilterRow = () => {
    sheet.view.showFilterRow = !sheet.view.showFilterRow;
    onChange();
    renderGrid();
  };

  const getActiveColumn = () => {
    if (!activeCellKey) return null;
    return keyToCoords(activeCellKey)?.col ?? null;
  };

  const sortRows = (direction) => {
    const col = getActiveColumn();
    if (col === null) {
      announce("Select a column to sort.");
      return;
    }
    const order = sheet.rowOrder.slice();
    order.sort((a, b) => {
      const keyA = cellKey(col, a);
      const keyB = cellKey(col, b);
      const valA = sheet.cells[keyA]?.v ?? sheet.cells[keyA]?.f ?? "";
      const valB = sheet.cells[keyB]?.v ?? sheet.cells[keyB]?.f ?? "";
      const numA = Number(valA);
      const numB = Number(valB);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return direction === "asc" ? numA - numB : numB - numA;
      }
      return direction === "asc"
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
    sheet.rowOrder = order;
    onChange();
    renderGrid();
  };

  const applyConditionalPreset = (preset) => {
    if (!preset) return;
    if (!selection?.start || !selection?.end) {
      announce("Select a range to apply conditional formatting.");
      return;
    }
    const rowMin = Math.min(selection.start.row, selection.end.row);
    const rowMax = Math.max(selection.start.row, selection.end.row);
    const colMin = Math.min(selection.start.col, selection.end.col);
    const colMax = Math.max(selection.start.col, selection.end.col);
    for (let r = rowMin; r <= rowMax; r += 1) {
      for (let c = colMin; c <= colMax; c += 1) {
        const key = cellKey(c, r);
        sheet.conditionals[key] = { preset };
      }
    }
    onChange();
    renderGrid();
  };

  const parseRange = (range) => {
    const match = range.match(/^([A-Z]+\d+):([A-Z]+\d+)$/);
    if (!match) return null;
    const start = keyToCoords(match[1]);
    const end = keyToCoords(match[2]);
    if (!start || !end) return null;
    return { start, end };
  };

  const getRangeValues = (range) => {
    const parsed = parseRange(range);
    if (!parsed) return [];
    const values = [];
    for (let r = parsed.start.row; r <= parsed.end.row; r += 1) {
      for (let c = parsed.start.col; c <= parsed.end.col; c += 1) {
        const key = cellKey(c, r);
        const raw = sheet.cells[key]?.v ?? sheet.cells[key]?.f ?? "";
        const num = Number(raw);
        if (!Number.isNaN(num)) values.push(num);
      }
    }
    return values;
  };

  const renderChart = () => {
    let panel = container.querySelector(".sheets__chart");
    if (!chartState.open) {
      panel?.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "sheets__chart";
      container.appendChild(panel);
    }
    const data = getRangeValues(chartState.range);
    const max = Math.max(1, ...data);
    const bars = data
      .map((value, index) => {
        const height = Math.round((value / max) * 80);
        return `<rect x="${index * 24}" y="${90 - height}" width="18" height="${height}" />`;
      })
      .join("");
    const line = data
      .map((value, index) => {
        const height = Math.round((value / max) * 80);
        return `${index * 24 + 9},${90 - height}`;
      })
      .join(" ");
    panel.innerHTML = `
      <div class="sheets__chart-header">
        <h3>Chart builder</h3>
        <button data-chart-action="close">Close</button>
      </div>
      <label>
        Type
        <select data-chart-field="type">
          <option value="bar" ${chartState.type === "bar" ? "selected" : ""}>Bar</option>
          <option value="line" ${chartState.type === "line" ? "selected" : ""}>Line</option>
        </select>
      </label>
      <label>
        Range
        <input type="text" data-chart-field="range" value="${chartState.range}" />
      </label>
      <div class="sheets__chart-preview">
        <svg viewBox="0 0 140 100" aria-label="Chart preview">
          ${
            chartState.type === "bar"
              ? `<g class="sheets__chart-bars">${bars}</g>`
              : `<polyline class="sheets__chart-line" points="${line}" />`
          }
        </svg>
        ${data.length ? "" : "<p>No numeric data in range.</p>"}
      </div>
    `;
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.chartAction;
      if (action === "close") {
        toggleChart();
      }
    });
    panel.addEventListener("change", (event) => {
      const field = event.target.closest("[data-chart-field]")?.dataset.chartField;
      if (!field) return;
      chartState[field] = event.target.value;
      sheet.chartState = chartState;
      onChange();
      renderChart();
    });
  };

  let activeCell = null;
  const handles = attachTouchSelectionHandles({
    container,
    getRect: () => activeCell?.getBoundingClientRect() ?? null,
    onAdjust: (point) => {
      const next = document.elementFromPoint(point.x, point.y)?.closest(".sheets__cell");
      if (next && !next.classList.contains("sheets__cell--header")) {
        next.focus();
      }
    }
  });

  const renderGrid = () => {
    grid.innerHTML = "";
    const headerRow = document.createElement("div");
    headerRow.className = "sheets__row sheets__row--header";
    headerRow.innerHTML = `<div class="sheets__cell sheets__cell--header"></div>`;
    if (sheet.view.freezeRow) {
      headerRow.classList.add("sheets__row--sticky");
    }
    for (let c = 0; c < cols; c += 1) {
      const header = document.createElement("div");
      header.className = "sheets__cell sheets__cell--header";
      header.textContent = COLS[c];
      headerRow.appendChild(header);
    }
    grid.appendChild(headerRow);

    if (sheet.view.showFilterRow) {
      const filterRow = document.createElement("div");
      filterRow.className = "sheets__row sheets__row--filter";
      filterRow.innerHTML = `<div class="sheets__cell sheets__cell--header">Filter</div>`;
      for (let c = 0; c < cols; c += 1) {
        const cell = document.createElement("div");
        cell.className = "sheets__cell sheets__cell--filter";
        const input = document.createElement("input");
        input.type = "text";
        input.value = sheet.filters[c] ?? "";
        input.dataset.filterCol = String(c);
        input.placeholder = "Filter";
        cell.appendChild(input);
        filterRow.appendChild(cell);
      }
      grid.appendChild(filterRow);
    }

    const rowsToRender = sheet.rowOrder.length
      ? sheet.rowOrder
      : Array.from({ length: rows }, (_, idx) => idx);
    rowsToRender.forEach((rowIndex) => {
      const row = document.createElement("div");
      row.className = "sheets__row";
      const header = document.createElement("div");
      header.className = "sheets__cell sheets__cell--header";
      if (sheet.view.freezeCol) {
        header.classList.add("sheets__cell--sticky");
      }
      header.textContent = rowIndex + 1;
      row.appendChild(header);
      let rowMatches = true;
      for (let c = 0; c < cols; c += 1) {
        const key = cellKey(c, rowIndex);
        const cell = document.createElement("div");
        cell.className = "sheets__cell";
        cell.dataset.cellKey = key;
        const rawValue = sheet.cells[key]?.f ?? sheet.cells[key]?.v ?? "";
        const format = sheet.formats[key];
        const validation = sheet.validations[key];
        const filterValue = sheet.filters[c];
        if (filterValue) {
          const text = String(rawValue).toLowerCase();
          if (!text.includes(filterValue.toLowerCase())) {
            rowMatches = false;
          }
        }
        if (validation && activeCellKey === key) {
          const select = document.createElement("select");
          select.dataset.validationKey = key;
          validation.forEach((option) => {
            const opt = document.createElement("option");
            opt.value = option;
            opt.textContent = option;
            if (option === rawValue) opt.selected = true;
            select.appendChild(opt);
          });
          cell.appendChild(select);
        } else {
          cell.contentEditable = "true";
          cell.textContent = formatValue(rawValue, format);
        }
        const conditional = sheet.conditionals[key];
        if (conditional?.preset === "positive") {
          const num = Number(rawValue);
          if (!Number.isNaN(num)) {
            cell.classList.add(num >= 0 ? "sheets__cell--pos" : "sheets__cell--neg");
          }
        }
        if (conditional?.preset === "heat") {
          const num = Number(rawValue);
          if (!Number.isNaN(num)) {
            const intensity = Math.min(1, Math.abs(num) / 100);
            cell.style.background = `rgba(59,130,246,${0.15 + intensity * 0.35})`;
          }
        }
        if (sheet.view.freezeCol && c === 0) {
          cell.classList.add("sheets__cell--sticky");
        }
        if (selection?.start && selection?.end) {
          const coords = { row: rowIndex, col: c };
          if (isWithinRange(coords, selection.start, selection.end)) {
            cell.classList.add("sheets__cell--selected");
          }
        }
        if (activeCellKey === key) {
          cell.classList.add("sheets__cell--active");
          const handle = document.createElement("span");
          handle.className = "sheets__fill-handle";
          handle.dataset.fillHandle = "true";
          cell.appendChild(handle);
        }
        row.appendChild(cell);
      }
      if (rowMatches) {
        grid.appendChild(row);
      }
    });
  };

  renderGrid();
  renderChart();

  grid.addEventListener("input", (event) => {
    const target = event.target.closest(".sheets__cell");
    if (!target || target.classList.contains("sheets__cell--header")) return;
    const key = target.dataset.cellKey;
    const value = target.textContent;
    const format = sheet.formats[key];
    if (value.startsWith("=")) {
      sheet.cells[key] = { f: value, t: "f" };
    } else {
      sheet.cells[key] = { v: value, t: "s" };
    }
    const evaluated = evaluateFormula(value, sheet.cells);
    if (value.startsWith("=")) {
      target.textContent = evaluated;
    } else if (format) {
      target.textContent = formatValue(value, format);
    }
    updateMeta(doc);
    onChange();
    renderGrid();
  });

  grid.addEventListener("change", (event) => {
    const select = event.target.closest("select")?.dataset.validationKey;
    if (!select) return;
    sheet.cells[select] = { v: event.target.value, t: "s" };
    updateMeta(doc);
    onChange();
    renderGrid();
  });

  grid.addEventListener("input", (event) => {
    const filterCol = event.target.closest("input")?.dataset.filterCol;
    if (filterCol === undefined) return;
    sheet.filters[filterCol] = event.target.value;
    onChange();
    renderGrid();
  });

  grid.addEventListener("focusin", (event) => {
    const target = event.target.closest(".sheets__cell");
    if (!target || target.classList.contains("sheets__cell--header")) return;
    const key = target.dataset.cellKey;
    activeCellKey = key;
    const coords = keyToCoords(key);
    if (coords) {
      selection = { start: coords, end: coords };
    }
    renderGrid();
    const value = target.textContent?.trim();
    activeCell = target;
    handles.setActive(true);
    if (value) {
      announce(`Selected cell ${key} with value ${value}.`);
    } else {
      announce(`Selected cell ${key}.`);
    }
  });
  grid.addEventListener("focusout", (event) => {
    if (!event.relatedTarget || !grid.contains(event.relatedTarget)) {
      activeCell = null;
      handles.setActive(false);
    }
  });

  grid.addEventListener("keydown", (event) => {
    if (!event.key.startsWith("Arrow")) return;
    if (!activeCellKey) return;
    const coords = keyToCoords(activeCellKey);
    if (!coords) return;
    const next = { ...coords };
    if (event.key === "ArrowUp") next.row = Math.max(0, coords.row - 1);
    if (event.key === "ArrowDown") next.row = Math.min(rows - 1, coords.row + 1);
    if (event.key === "ArrowLeft") next.col = Math.max(0, coords.col - 1);
    if (event.key === "ArrowRight") next.col = Math.min(cols - 1, coords.col + 1);
    const nextKey = cellKey(next.col, next.row);
    const nextCell = grid.querySelector(`[data-cell-key="${nextKey}"]`);
    if (nextCell) {
      event.preventDefault();
      nextCell.focus();
    }
  });

  grid.addEventListener("mousedown", (event) => {
    const handle = event.target.closest(".sheets__fill-handle");
    if (handle && activeCellKey) {
      event.preventDefault();
      fillDrag = { startKey: activeCellKey, currentKey: activeCellKey };
      return;
    }
    const target = event.target.closest(".sheets__cell");
    if (!target || target.classList.contains("sheets__cell--header")) return;
    const key = target.dataset.cellKey;
    const coords = keyToCoords(key);
    if (!coords) return;
    activeCellKey = key;
    selection = { start: coords, end: coords };
    isSelecting = true;
    renderGrid();
  });

  grid.addEventListener("mouseover", (event) => {
    const target = event.target.closest(".sheets__cell");
    if (!target || target.classList.contains("sheets__cell--header")) return;
    const key = target.dataset.cellKey;
    const coords = keyToCoords(key);
    if (!coords) return;
    if (isSelecting && selection) {
      selection.end = coords;
      renderGrid();
    }
    if (fillDrag) {
      fillDrag.currentKey = key;
      selection = { start: keyToCoords(fillDrag.startKey), end: coords };
      renderGrid();
    }
  });

  document.addEventListener("mouseup", () => {
    if (isSelecting) {
      isSelecting = false;
    }
    if (fillDrag) {
      const start = keyToCoords(fillDrag.startKey);
      const end = keyToCoords(fillDrag.currentKey);
      if (start && end) {
        const rowMin = Math.min(start.row, end.row);
        const rowMax = Math.max(start.row, end.row);
        const colMin = Math.min(start.col, end.col);
        const colMax = Math.max(start.col, end.col);
        const sourceKey = fillDrag.startKey;
        const sourceCell = sheet.cells[sourceKey];
        const sourceFormat = sheet.formats[sourceKey];
        for (let r = rowMin; r <= rowMax; r += 1) {
          for (let c = colMin; c <= colMax; c += 1) {
            const destKey = cellKey(c, r);
            if (destKey === sourceKey) continue;
            if (sourceCell) {
              sheet.cells[destKey] = JSON.parse(JSON.stringify(sourceCell));
            }
            if (sourceFormat) {
              sheet.formats[destKey] = { ...sourceFormat };
            }
          }
        }
        onChange();
      }
      fillDrag = null;
      renderGrid();
    }
  });

  toolbar.addEventListener("click", (event) => {
    const cmd = event.target.closest("button")?.dataset.cmd;
    if (!cmd) return;
    if (cmd === "toggleChart") {
      toggleChart();
    }
    if (cmd === "validation") {
      applyValidation();
    }
    if (cmd === "toggleFilter") {
      toggleFilterRow();
    }
    if (cmd === "sortAsc") {
      sortRows("asc");
    }
    if (cmd === "sortDesc") {
      sortRows("desc");
    }
    if (cmd === "freezeRow") {
      toggleFreezeRow();
    }
    if (cmd === "freezeCol") {
      toggleFreezeCol();
    }
    if (cmd === "addRow") {
      addRow();
    }
    if (cmd === "addCol") {
      addCol();
    }
    if (cmd === "formatBold") {
      document.execCommand("bold");
    }
    if (cmd === "sum") {
      autoSum();
    }
  });

  toolbar.addEventListener("change", (event) => {
    const target = event.target.closest("[data-cmd]");
    const cmd = target?.dataset.cmd;
    if (!cmd) return;
    const formatType =
      toolbar.querySelector("[data-cmd='formatType']")?.value ?? "text";
    const decimals = Number(
      toolbar.querySelector("[data-cmd='formatDecimals']")?.value ?? 2
    );
    const preset = toolbar.querySelector("[data-cmd='conditionalPreset']")?.value ?? "";
    if (cmd === "formatType" || cmd === "formatDecimals") {
      applyFormatToActive({ type: formatType, decimals });
    }
    if (cmd === "conditionalPreset") {
      applyConditionalPreset(preset);
    }
  });

  registry.register({
    id: "sheets.freezeRow",
    label: "Sheets: Toggle Freeze Row",
    handler: toggleFreezeRow
  });
  registry.register({
    id: "sheets.freezeCol",
    label: "Sheets: Toggle Freeze Column",
    handler: toggleFreezeCol
  });
  registry.register({
    id: "sheets.addRow",
    label: "Sheets: Add Row",
    handler: addRow
  });
  registry.register({
    id: "sheets.addCol",
    label: "Sheets: Add Column",
    handler: addCol
  });
  registry.register({
    id: "sheets.autosum",
    label: "Sheets: AutoSum",
    handler: autoSum
  });
  registry.register({
    id: "sheets.toggleChart",
    label: "Sheets: Toggle Chart Panel",
    handler: toggleChart
  });
  registry.register({
    id: "sheets.validation",
    label: "Sheets: Apply Validation",
    handler: applyValidation
  });
  registry.register({
    id: "sheets.toggleFilter",
    label: "Sheets: Toggle Filter Row",
    handler: toggleFilterRow
  });
  registry.register({
    id: "sheets.sortAsc",
    label: "Sheets: Sort Column Asc",
    handler: () => sortRows("asc")
  });
  registry.register({
    id: "sheets.sortDesc",
    label: "Sheets: Sort Column Desc",
    handler: () => sortRows("desc")
  });

  container.appendChild(grid);
  return container;
}
