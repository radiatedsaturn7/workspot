import { updateMeta } from "../data.js";
import { attachTouchSelectionHandles } from "../a11y.js";

export function createBaseApp({ doc, registry, onChange, onAnnounce, dialogs }) {
  const container = document.createElement("section");
  container.className = "base";
  const announce = onAnnounce ?? (() => {});
  const promptDialog = dialogs?.prompt ?? window.prompt;
  const confirmDialog = dialogs?.confirm ?? window.confirm;

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar toolbar--touch";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Base toolbar");
  toolbar.innerHTML = `
    <button data-cmd="addTable">New Table</button>
    <button class="base__wizard-only" data-cmd="addTableWizard">New Table (Wizard)</button>
    <button data-cmd="renameTable">Rename Table</button>
    <button data-cmd="deleteTable">Delete Table</button>
    <button data-cmd="addField">Add Field</button>
    <button data-cmd="deleteField">Delete Field</button>
    <button class="base__wizard-only" data-cmd="addFieldWizard">Add Field (Wizard)</button>
    <button data-cmd="addRecord">Add Record</button>
    <button data-cmd="deleteRecord">Delete Record</button>
    <button data-cmd="importCsv">Import CSV</button>
    <button data-cmd="exportCsv">Export CSV</button>
    <div class="toolbar__field">
      <label for="base-sort-field">Sort</label>
      <select id="base-sort-field" data-field="sortField"></select>
      <select data-field="sortDirection" aria-label="Sort direction">
        <option value="asc">Asc</option>
        <option value="desc">Desc</option>
      </select>
    </div>
    <div class="toolbar__field">
      <label for="base-filter">Filter</label>
      <input id="base-filter" type="text" data-field="filterQuery" placeholder="Search records" />
    </div>
  `;
  container.appendChild(toolbar);

  let currentTableIndex = 0;
  let selectedRecordId = null;
  let sortFieldName = "";
  let sortDirection = "asc";
  let filterQuery = "";
  let columnFilters = {};
  let pageIndex = 0;
  const pageSize = 25;
  const sidebar = document.createElement("div");
  sidebar.className = "base__sidebar";
  const main = document.createElement("div");
  main.className = "base__main";
  const inspector = document.createElement("aside");
  inspector.className = "base__inspector";
  const tabBar = document.createElement("div");
  tabBar.className = "base__tabs";
  const tableView = document.createElement("div");
  tableView.className = "base__table";
  const designView = document.createElement("div");
  designView.className = "base__design";

  const layout = document.createElement("div");
  layout.className = "base__layout";
  layout.appendChild(sidebar);
  layout.appendChild(main);
  layout.appendChild(inspector);
  container.appendChild(layout);

  let activeCell = null;
  let activeTab = "datasheet";
  let selectedField = null;
  const handles = attachTouchSelectionHandles({
    container,
    getRect: () => activeCell?.getBoundingClientRect() ?? null,
    onAdjust: (point) => {
      const next = document.elementFromPoint(point.x, point.y)?.closest(".base__cell");
      if (next && !next.classList.contains("base__cell--header")) {
        next.focus();
      }
    }
  });

  const addTable = () => {
    doc.tables.push({
      id: `tbl_${crypto.randomUUID()}`,
      name: `Table${doc.tables.length + 1}`,
      fields: [{ id: `fld_${crypto.randomUUID()}`, name: "ID", type: "number" }],
      records: []
    });
    currentTableIndex = doc.tables.length - 1;
    updateMeta(doc);
    onChange();
    renderTables();
    renderTableView();
    renderInspector();
  };

  const renameTable = async () => {
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    const name = await promptDialog("Table name", { title: "Rename table", value: table.name });
    if (!name) return;
    table.name = name;
    updateMeta(doc);
    onChange();
    renderTables();
    renderTableView();
    renderInspector();
  };

  const deleteTable = async () => {
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    const confirmed = await confirmDialog(`Delete "${table.name}"?`, {
      title: "Delete table"
    });
    if (!confirmed) return;
    doc.tables.splice(currentTableIndex, 1);
    currentTableIndex = Math.max(0, currentTableIndex - 1);
    selectedRecordId = null;
    updateMeta(doc);
    onChange();
    renderTables();
    renderTableView();
    renderInspector();
  };

  const parseBooleanAnswer = (answer) => {
    if (!answer) return false;
    return ["yes", "y", "true", "1"].includes(String(answer).trim().toLowerCase());
  };

  const isMobileView = () => window.matchMedia("(max-width: 900px)").matches;

  const parseFieldValue = (type, value) => {
    if (value === null || value === undefined) return "";
    const raw = String(value).trim();
    if (!raw && type !== "boolean") return "";
    if (type === "number" || type === "autonumber") {
      const parsed = Number.parseFloat(raw);
      return Number.isNaN(parsed) ? "" : parsed;
    }
    if (type === "boolean") {
      return parseBooleanAnswer(raw);
    }
    if (type === "date") {
      return raw;
    }
    return raw;
  };

  const promptForFieldDetails = async (field) => {
    const name = await promptDialog("Field name", {
      title: field ? "Edit field" : "Add field",
      value: field?.name ?? ""
    });
    if (!name) return null;
    const type = await promptDialog(
      "Field type (text, number, date, boolean, autonumber, choice, relation)",
      {
        title: field ? "Edit field" : "Add field",
        value: field?.type ?? "text"
      }
    );
    if (!type) return null;
    const normalizedType = type.trim().toLowerCase();
    let options = field?.options ?? [];
    if (normalizedType === "choice") {
      const optionsInput = await promptDialog("Choice options (comma-separated)", {
        title: "Choice options",
        value: options.join(", ")
      });
      options = (optionsInput ?? "")
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean);
    }
    let foreignKey = field?.foreignKey ?? null;
    if (normalizedType === "relation") {
      const tableNames = doc.tables.map((table) => table.name).join(", ");
      const relatedTableName = await promptDialog(
        `Related table (${tableNames || "none"})`,
        {
          title: "Relation"
        }
      );
      const relatedTable = doc.tables.find((table) => table.name === relatedTableName);
      const displayField = relatedTable?.fields?.[0]?.name ?? "";
      const displayFieldName = await promptDialog("Display field", {
        title: "Relation",
        value: foreignKey?.displayField ?? displayField
      });
      if (relatedTable) {
        foreignKey = {
          tableId: relatedTable.id,
          displayField: displayFieldName || displayField
        };
      } else {
        foreignKey = null;
      }
    }
    const defaultValueInput = await promptDialog("Default value (optional)", {
      title: "Field default",
      value: field?.defaultValue ?? ""
    });
    const requiredInput = await promptDialog("Required? (yes/no)", {
      title: "Field required",
      value: field?.required ? "yes" : "no"
    });
    const primaryKeyInput = await promptDialog("Primary key? (yes/no)", {
      title: "Primary key",
      value: field?.primaryKey ? "yes" : "no"
    });
    const uniqueInput = await promptDialog("Unique values? (yes/no)", {
      title: "Unique",
      value: field?.unique ? "yes" : "no"
    });
    const indexedInput = await promptDialog("Indexed? (none, duplicates, unique)", {
      title: "Indexed",
      value: field?.indexed ?? "none"
    });
    const validationRuleInput = await promptDialog(
      "Validation rule (e.g. regex:^\\d+$, min:0, max:100, contains:abc)",
      {
        title: "Validation rule",
        value: field?.validationRule ?? ""
      }
    );
    const validationTextInput = await promptDialog("Validation text (error message)", {
      title: "Validation text",
      value: field?.validationText ?? ""
    });
    const primaryKey = parseBooleanAnswer(primaryKeyInput);
    const indexedValue = (indexedInput ?? "none").trim().toLowerCase();
    const indexed =
      indexedValue === "unique" || indexedValue === "no duplicates"
        ? "unique"
        : indexedValue === "duplicates" || indexedValue === "duplicates ok"
          ? "duplicates"
          : "none";
    const unique = parseBooleanAnswer(uniqueInput) || primaryKey || indexed === "unique";
    const required = parseBooleanAnswer(requiredInput) || primaryKey;
    return {
      name: name.trim(),
      type: normalizedType,
      options,
      foreignKey,
      defaultValue: parseFieldValue(normalizedType, defaultValueInput),
      required,
      primaryKey,
      unique,
      indexed,
      validationRule: validationRuleInput?.trim() ?? "",
      validationText: validationTextInput?.trim() ?? ""
    };
  };

  const normalizeRule = (rule) => (rule || "").trim();

  const isValueValidForRule = (rule, value) => {
    const normalized = normalizeRule(rule);
    if (!normalized) return true;
    const textValue = value === null || value === undefined ? "" : String(value);
    if (normalized.startsWith("regex:")) {
      const pattern = normalized.slice(6);
      try {
        const regex = new RegExp(pattern);
        return regex.test(textValue);
      } catch (error) {
        return true;
      }
    }
    if (normalized.startsWith("min:")) {
      const minValue = Number.parseFloat(normalized.slice(4));
      const numericValue = Number.parseFloat(textValue);
      if (Number.isNaN(minValue) || Number.isNaN(numericValue)) return true;
      return numericValue >= minValue;
    }
    if (normalized.startsWith("max:")) {
      const maxValue = Number.parseFloat(normalized.slice(4));
      const numericValue = Number.parseFloat(textValue);
      if (Number.isNaN(maxValue) || Number.isNaN(numericValue)) return true;
      return numericValue <= maxValue;
    }
    if (normalized.startsWith("contains:")) {
      const needle = normalized.slice(9);
      return textValue.includes(needle);
    }
    return textValue === normalized;
  };

  const addField = async () => {
    const table = doc.tables[currentTableIndex];
    const details = await promptForFieldDetails();
    if (!details?.name) return;
    table.fields.push({
      id: `fld_${crypto.randomUUID()}`,
      name: details.name,
      type: details.type || "text",
      options: details.options ?? [],
      foreignKey: details.foreignKey ?? null,
      defaultValue: details.defaultValue ?? "",
      required: details.required ?? false,
      primaryKey: details.primaryKey ?? false,
      unique: details.unique ?? false,
      indexed: details.indexed ?? "none",
      validationRule: details.validationRule ?? "",
      validationText: details.validationText ?? ""
    });
    if (details.primaryKey) {
      table.fields.forEach((field) => {
        if (field.name !== details.name) {
          field.primaryKey = false;
        }
      });
    }
    table.records.forEach((record) => {
      if (record.values[details.name] === undefined) {
        record.values[details.name] = details.defaultValue ?? "";
      }
    });
    updateMeta(doc);
    onChange();
    renderTableView();
    renderInspector();
  };

  const deleteField = async (fieldToDelete) => {
    const table = doc.tables[currentTableIndex];
    if (!table || !table.fields.length) return;
    const field = fieldToDelete ?? selectedField ?? table.fields[0];
    if (!field) return;
    const confirmed = await confirmDialog(`Delete field "${field.name}"?`, {
      title: "Delete field"
    });
    if (!confirmed) return;
    table.fields = table.fields.filter((entry) => entry !== field);
    table.records.forEach((record) => {
      delete record.values[field.name];
    });
    if (selectedField === field) {
      selectedField = null;
    }
    updateMeta(doc);
    onChange();
    renderTableView();
    renderInspector();
  };

  const addFieldWizard = async () => {
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    const details = await promptForFieldDetails();
    if (!details?.name) return;
    table.fields.push({
      id: `fld_${crypto.randomUUID()}`,
      name: details.name,
      type: details.type || "text",
      options: details.options ?? [],
      foreignKey: details.foreignKey ?? null,
      defaultValue: details.defaultValue ?? "",
      required: details.required ?? false,
      primaryKey: details.primaryKey ?? false,
      unique: details.unique ?? false,
      indexed: details.indexed ?? "none",
      validationRule: details.validationRule ?? "",
      validationText: details.validationText ?? ""
    });
    if (details.primaryKey) {
      table.fields.forEach((field) => {
        if (field.name !== details.name) {
          field.primaryKey = false;
        }
      });
    }
    table.records.forEach((record) => {
      if (record.values[details.name] === undefined) {
        record.values[details.name] = details.defaultValue ?? "";
      }
    });
    updateMeta(doc);
    onChange();
    renderTableView();
    renderInspector();
  };

  const addTableWizard = async () => {
    const name = await promptDialog("Table name", { title: "Create table wizard" });
    if (!name) return;
    const fieldsInput = await promptDialog(
      "Initial fields (comma-separated)",
      { title: "Create table wizard", value: "Name" }
    );
    const type = await promptDialog(
      "Default field type (text, number, date, boolean, choice)",
      { title: "Create table wizard", value: "text" }
    );
    const fieldNames = (fieldsInput ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const normalizedType = type?.trim().toLowerCase() || "text";
    const fields = (fieldNames.length ? fieldNames : ["Name"]).map((fieldName) => ({
      id: `fld_${crypto.randomUUID()}`,
      name: fieldName,
      type: normalizedType,
      options: normalizedType === "choice" ? ["Option 1", "Option 2"] : [],
      foreignKey: null,
      defaultValue: "",
      required: false,
      primaryKey: false,
      unique: false,
      indexed: "none",
      validationRule: "",
      validationText: ""
    }));
    doc.tables.push({
      id: `tbl_${crypto.randomUUID()}`,
      name,
      fields,
      records: []
    });
    currentTableIndex = doc.tables.length - 1;
    updateMeta(doc);
    onChange();
    renderTables();
    renderTableView();
    renderInspector();
  };

  const editField = async (field) => {
    const table = doc.tables[currentTableIndex];
    if (!table || !field) return;
    const details = await promptForFieldDetails(field);
    if (!details?.name) return;
    const nextName = details.name.trim();
    if (nextName !== field.name) {
      table.records.forEach((record) => {
        record.values[nextName] = record.values[field.name] ?? "";
        delete record.values[field.name];
      });
    }
    field.name = nextName;
    field.type = details.type || field.type || "text";
    field.options = details.options ?? field.options ?? [];
    field.foreignKey = details.foreignKey ?? field.foreignKey ?? null;
    field.defaultValue = details.defaultValue ?? field.defaultValue ?? "";
    field.required = details.required ?? field.required ?? false;
    field.primaryKey = details.primaryKey ?? field.primaryKey ?? false;
    field.unique = details.unique ?? field.unique ?? false;
    field.indexed = details.indexed ?? field.indexed ?? "none";
    field.validationRule = details.validationRule ?? field.validationRule ?? "";
    field.validationText = details.validationText ?? field.validationText ?? "";
    if (field.primaryKey) {
      table.fields.forEach((otherField) => {
        if (otherField.name !== field.name) {
          otherField.primaryKey = false;
        }
      });
    }
    updateMeta(doc);
    onChange();
    renderTableView();
    renderInspector();
  };

  const addRecord = () => {
    const table = doc.tables[currentTableIndex];
    const record = { id: `rec_${crypto.randomUUID()}`, values: {} };
    table.fields.forEach((field) => {
      if (field.type === "autonumber") {
        const maxValue = table.records.reduce((max, existing) => {
          const value = Number.parseInt(existing.values[field.name], 10);
          if (Number.isNaN(value)) return max;
          return Math.max(max, value);
        }, 0);
        record.values[field.name] = maxValue + 1;
      } else if (field.defaultValue !== undefined && field.defaultValue !== "") {
        record.values[field.name] = field.defaultValue;
      } else if (field.type === "boolean") {
        record.values[field.name] = false;
      } else {
        record.values[field.name] = "";
      }
    });
    table.records.push(record);
    updateMeta(doc);
    onChange({ batchKey: "base.addRecord" });
    renderTableView();
    renderInspector();
  };

  const deleteRecord = () => {
    const table = doc.tables[currentTableIndex];
    if (!table || !selectedRecordId) return;
    const index = table.records.findIndex((record) => record.id === selectedRecordId);
    if (index === -1) return;
    table.records.splice(index, 1);
    selectedRecordId = null;
    updateMeta(doc);
    onChange({ batchKey: "base.deleteRecord" });
    renderTableView();
    renderInspector();
  };

  const moveField = (fieldIndex, direction) => {
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    const nextIndex = fieldIndex + direction;
    if (nextIndex < 0 || nextIndex >= table.fields.length) return;
    const [field] = table.fields.splice(fieldIndex, 1);
    table.fields.splice(nextIndex, 0, field);
    updateMeta(doc);
    onChange({ batchKey: "base.moveField" });
    renderTableView();
  };

  const updateSortOptions = (table) => {
    const sortSelect = toolbar.querySelector('[data-field="sortField"]');
    if (!sortSelect) return;
    sortSelect.innerHTML = `<option value="">Unsorted</option>`;
    table?.fields.forEach((field) => {
      const option = document.createElement("option");
      option.value = field.name;
      option.textContent = field.name;
      sortSelect.appendChild(option);
    });
    if (sortFieldName && table?.fields.some((field) => field.name === sortFieldName)) {
      sortSelect.value = sortFieldName;
    } else {
      sortFieldName = "";
      sortSelect.value = "";
    }
  };

  const getDisplayedRecords = (table) => {
    let records = [...table.records];
    const query = filterQuery.trim().toLowerCase();
    if (query) {
      records = records.filter((record) =>
        table.fields.some((field) =>
          String(record.values[field.name] ?? "").toLowerCase().includes(query)
        )
      );
    }
    const activeFilters = Object.entries(columnFilters).filter(([, value]) => value?.trim());
    if (activeFilters.length) {
      records = records.filter((record) =>
        activeFilters.every(([fieldName, value]) =>
          String(record.values[fieldName] ?? "")
            .toLowerCase()
            .includes(value.trim().toLowerCase())
        )
      );
    }
    if (sortFieldName) {
      const sortField = table.fields.find((field) => field.name === sortFieldName);
      if (sortField) {
        const direction = sortDirection === "desc" ? -1 : 1;
        records.sort((a, b) => {
          const left = a.values[sortField.name];
          const right = b.values[sortField.name];
          if (sortField.type === "number" || sortField.type === "autonumber") {
            const leftNumber = Number.parseFloat(left);
            const rightNumber = Number.parseFloat(right);
            if (Number.isNaN(leftNumber) && Number.isNaN(rightNumber)) return 0;
            if (Number.isNaN(leftNumber)) return 1;
            if (Number.isNaN(rightNumber)) return -1;
            return (leftNumber - rightNumber) * direction;
          }
          if (sortField.type === "boolean") {
            return (Number(Boolean(left)) - Number(Boolean(right))) * direction;
          }
          if (sortField.type === "date") {
            const leftDate = new Date(left).getTime();
            const rightDate = new Date(right).getTime();
            if (Number.isNaN(leftDate) && Number.isNaN(rightDate)) return 0;
            if (Number.isNaN(leftDate)) return 1;
            if (Number.isNaN(rightDate)) return -1;
            return (leftDate - rightDate) * direction;
          }
          return (
            String(left ?? "").localeCompare(String(right ?? ""), undefined, {
              numeric: true,
              sensitivity: "base"
            }) * direction
          );
        });
      }
    }
    const total = records.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (pageIndex >= totalPages) {
      pageIndex = totalPages - 1;
    }
    const start = pageIndex * pageSize;
    return {
      records: records.slice(start, start + pageSize),
      total,
      totalPages
    };
  };

  const parseCsvLine = (line) =>
    line
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((value) => value.replace(/^"|"$/g, "").replace(/""/g, '"').trim());

  const serializeCsvValue = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const importCsv = async () => {
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    const csvText = await promptDialog("Paste CSV content", { title: "Import CSV" });
    if (!csvText) return;
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length);
    if (!lines.length) return;
    const headers = parseCsvLine(lines[0]);
    if (!headers.length) return;
    const shouldCreate = await confirmDialog("Create missing fields for CSV headers?", {
      title: "Import CSV"
    });
    headers.forEach((header) => {
      if (!table.fields.some((field) => field.name === header) && shouldCreate) {
        table.fields.push({
          id: `fld_${crypto.randomUUID()}`,
          name: header,
          type: "text",
          options: [],
          defaultValue: "",
          required: false,
          primaryKey: false,
          unique: false
        });
      }
    });
    lines.slice(1).forEach((line) => {
      const values = parseCsvLine(line);
      const record = { id: `rec_${crypto.randomUUID()}`, values: {} };
    table.fields.forEach((field, index) => {
      const headerIndex = headers.indexOf(field.name);
      const rawValue = headerIndex >= 0 ? values[headerIndex] : "";
      record.values[field.name] = parseFieldValue(field.type, rawValue);
    });
      table.records.push(record);
    });
    updateMeta(doc);
    onChange({ batchKey: "base.importCsv" });
    renderTableView();
  };

  const exportCsv = () => {
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    const headers = table.fields.map((field) => field.name);
    const rows = table.records.map((record) =>
      headers
        .map((header) => serializeCsvValue(record.values[header]))
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${table.name || "table"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  function renderTables() {
    sidebar.innerHTML = "";
    const sections = [
      { title: "Tables", items: doc.tables.map((table, index) => ({ label: table.name, index })) },
      { title: "Queries", items: [] },
      { title: "Forms", items: [] },
      { title: "Reports", items: [] }
    ];
    sections.forEach((section) => {
      const container = document.createElement("div");
      container.className = "base__nav-section";
      const heading = document.createElement("h3");
      heading.textContent = section.title;
      container.appendChild(heading);
      if (!section.items.length) {
        const empty = document.createElement("p");
        empty.className = "base__nav-empty";
        empty.textContent = "No items yet";
        container.appendChild(empty);
      }
      section.items.forEach((item) => {
        const button = document.createElement("button");
        button.className = "base__table-button";
        button.textContent = item.label;
        button.dataset.index = item.index;
        if (item.index === currentTableIndex) {
          button.classList.add("active");
        }
        container.appendChild(button);
      });
      sidebar.appendChild(container);
    });
  }

  function renderTabs() {
    tabBar.innerHTML = "";
    const tabs = [
      { id: "datasheet", label: "Datasheet" },
      { id: "design", label: "Design" }
    ];
    tabs.forEach((tab) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "base__tab";
      button.textContent = tab.label;
      if (activeTab === tab.id) {
        button.classList.add("active");
      }
      button.addEventListener("click", () => {
        activeTab = tab.id;
        renderTableView();
      });
      tabBar.appendChild(button);
    });
  }

  function renderDesignView() {
    designView.innerHTML = "";
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    const list = document.createElement("div");
    list.className = "base__design-list";
    table.fields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "base__design-row";
      const summary = document.createElement("div");
      summary.innerHTML = `
        <strong>${field.name}</strong>
        <span>${field.type}</span>
      `;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Edit";
      button.addEventListener("click", () => {
        selectedField = field;
        editField(field);
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "base__design-delete";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await deleteField(field);
      });
      row.addEventListener("click", () => {
        selectedField = field;
        renderInspector();
      });
      row.appendChild(summary);
      row.appendChild(button);
      row.appendChild(deleteButton);
      list.appendChild(row);
    });
    designView.appendChild(list);
  }

  function renderInspector() {
    inspector.innerHTML = "";
    const table = doc.tables[currentTableIndex];
    const header = document.createElement("h3");
    header.textContent = "Inspector";
    inspector.appendChild(header);
    if (!table || !selectedField) {
      const empty = document.createElement("p");
      empty.className = "base__inspector-empty";
      empty.textContent = "Select a field to see details.";
      inspector.appendChild(empty);
      return;
    }
    const details = document.createElement("div");
    details.className = "base__inspector-details";
    details.innerHTML = `
      <p><strong>Field</strong>: ${selectedField.name}</p>
      <p><strong>Type</strong>: ${selectedField.type}</p>
      <p><strong>Required</strong>: ${selectedField.required ? "Yes" : "No"}</p>
      <p><strong>Primary key</strong>: ${selectedField.primaryKey ? "Yes" : "No"}</p>
      <p><strong>Unique</strong>: ${selectedField.unique ? "Yes" : "No"}</p>
      <p><strong>Indexed</strong>: ${selectedField.indexed ?? "none"}</p>
      <p><strong>Relation</strong>: ${
        selectedField.foreignKey?.tableId
          ? `${doc.tables.find((table) => table.id === selectedField.foreignKey.tableId)?.name ?? "Unknown"} → ${selectedField.foreignKey.displayField ?? "id"}`
          : "None"
      }</p>
      <p><strong>Default</strong>: ${selectedField.defaultValue ?? ""}</p>
      <p><strong>Validation</strong>: ${
        selectedField.validationRule ? selectedField.validationRule : "None"
      }</p>
    `;
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "base__inspector-action";
    editButton.textContent = "Edit field";
    editButton.addEventListener("click", () => {
      editField(selectedField);
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "base__inspector-action";
    deleteButton.textContent = "Delete field";
    deleteButton.addEventListener("click", async () => {
      await deleteField(selectedField);
    });
    inspector.appendChild(details);
    inspector.appendChild(editButton);
    inspector.appendChild(deleteButton);
  }

  function renderTableView() {
    renderTabs();
    main.innerHTML = "";
    main.appendChild(tabBar);
    tableView.innerHTML = "";
    const table = doc.tables[currentTableIndex];
    if (!table) return;
    updateSortOptions(table);
    if (activeTab === "design") {
      renderDesignView();
      main.appendChild(designView);
      renderInspector();
      return;
    }

    const header = document.createElement("div");
    header.className = "base__row base__row--header";
    table.fields.forEach((field, fieldIndex) => {
      const cell = document.createElement("div");
      cell.className = "base__cell base__cell--header";
      const label = document.createElement("button");
      label.type = "button";
      label.className = "base__field-label";
      label.textContent = `${field.name} (${field.type})`;
      label.setAttribute("aria-label", `Edit field ${field.name}`);
      label.addEventListener("click", () => {
        selectedField = field;
        editField(field);
      });
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          editField(field);
        }
      });
      const controls = document.createElement("div");
      controls.className = "base__field-controls";
      const sortButton = document.createElement("button");
      sortButton.type = "button";
      sortButton.className = "base__field-sort";
      const isSorted = sortFieldName === field.name;
      sortButton.textContent = isSorted ? (sortDirection === "asc" ? "▲" : "▼") : "↕";
      sortButton.setAttribute("aria-label", `Sort by ${field.name}`);
      sortButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (sortFieldName !== field.name) {
          sortFieldName = field.name;
          sortDirection = "asc";
        } else {
          sortDirection = sortDirection === "asc" ? "desc" : "asc";
        }
        pageIndex = 0;
        updateSortOptions(table);
        renderTableView();
      });
      const leftButton = document.createElement("button");
      leftButton.type = "button";
      leftButton.className = "base__field-move";
      leftButton.textContent = "◀";
      leftButton.disabled = fieldIndex === 0;
      leftButton.setAttribute("aria-label", `Move ${field.name} left`);
      leftButton.addEventListener("click", (event) => {
        event.stopPropagation();
        moveField(fieldIndex, -1);
      });
      const rightButton = document.createElement("button");
      rightButton.type = "button";
      rightButton.className = "base__field-move";
      rightButton.textContent = "▶";
      rightButton.disabled = fieldIndex === table.fields.length - 1;
      rightButton.setAttribute("aria-label", `Move ${field.name} right`);
      rightButton.addEventListener("click", (event) => {
        event.stopPropagation();
        moveField(fieldIndex, 1);
      });
      controls.appendChild(sortButton);
      controls.appendChild(leftButton);
      controls.appendChild(rightButton);
      cell.appendChild(label);
      cell.appendChild(controls);
      const filterInput = document.createElement("input");
      filterInput.className = "base__field-filter";
      filterInput.type = "text";
      filterInput.placeholder = "Filter";
      filterInput.value = columnFilters[field.name] ?? "";
      filterInput.addEventListener("focus", () => {
        selectedField = field;
        renderInspector();
      });
      filterInput.addEventListener("input", (event) => {
        columnFilters = { ...columnFilters, [field.name]: event.target.value };
        pageIndex = 0;
        renderTableView();
      });
      cell.appendChild(filterInput);
      header.appendChild(cell);
    });
    tableView.appendChild(header);

    const isDuplicateValue = (value, fieldName, recordId) =>
      table.records.some(
        (record) => record.id !== recordId && record.values[fieldName] === value
      );

    const { records: displayedRecords, total, totalPages } = getDisplayedRecords(table);
    displayedRecords.forEach((record, rowIndex) => {
      const row = document.createElement("div");
      row.className = "base__row";
      row.dataset.index = rowIndex;
      if (record.id === selectedRecordId) {
        row.classList.add("base__row--selected");
      }
      row.addEventListener("click", () => {
        selectedRecordId = record.id;
        tableView.querySelectorAll(".base__row--selected").forEach((selected) => {
          selected.classList.remove("base__row--selected");
        });
        row.classList.add("base__row--selected");
      });
      table.fields.forEach((field) => {
        const cell = document.createElement("div");
        cell.className = "base__cell";
        cell.dataset.fieldName = field.name;
        cell.dataset.rowIndex = rowIndex + 1;
        const updateValue = (value) => {
          record.values[field.name] = value;
          updateMeta(doc);
          onChange({ batchKey: "base.editCell" });
          const isRequiredMissing =
            field.required && (value === "" || value === null || value === undefined);
          const isPrimaryKeyMissing = field.primaryKey && isRequiredMissing;
          const isDuplicate =
            (field.primaryKey || field.unique) && isDuplicateValue(value, field.name, record.id);
          const isRuleValid = isValueValidForRule(field.validationRule, value);
          cell.classList.toggle(
            "base__cell--invalid",
            isRequiredMissing || isDuplicate || !isRuleValid
          );
          if (isPrimaryKeyMissing) {
            cell.title = "Primary key required";
          } else if (isDuplicate) {
            cell.title = "Value must be unique";
          } else if (!isRuleValid) {
            cell.title = field.validationText || "Validation rule failed";
          } else {
            cell.removeAttribute("title");
          }
        };
        const focusHandler = () => {
          announce(`Selected row ${rowIndex + 1}, field ${field.name}.`);
          activeCell = cell;
          selectedRecordId = record.id;
          selectedField = field;
          renderInspector();
          handles.setActive(true);
        };
        const blurHandler = () => {
          if (activeCell === cell) {
            activeCell = null;
            handles.setActive(false);
          }
        };
        const currentValue = record.values[field.name] ?? "";
        if (field.type === "relation" && field.foreignKey?.tableId) {
          const relatedTable = doc.tables.find(
            (table) => table.id === field.foreignKey.tableId
          );
          const select = document.createElement("select");
          select.innerHTML = `<option value=""></option>`;
          if (relatedTable) {
            const labelField =
              field.foreignKey.displayField || relatedTable.fields[0]?.name;
            relatedTable.records.forEach((relatedRecord) => {
              const optionEl = document.createElement("option");
              optionEl.value = relatedRecord.id;
              const label = labelField ? relatedRecord.values[labelField] : relatedRecord.id;
              optionEl.textContent = label ?? relatedRecord.id;
              select.appendChild(optionEl);
            });
          }
          select.value = String(currentValue ?? "");
          select.addEventListener("change", () => {
            updateValue(select.value);
          });
          select.addEventListener("focus", focusHandler);
          select.addEventListener("blur", blurHandler);
          cell.appendChild(select);
        } else if (field.type === "boolean") {
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = Boolean(currentValue);
          input.addEventListener("change", () => {
            updateValue(input.checked);
          });
          input.addEventListener("focus", focusHandler);
          input.addEventListener("blur", blurHandler);
          cell.appendChild(input);
        } else if (field.type === "choice") {
          const select = document.createElement("select");
          select.innerHTML = `<option value=""></option>`;
          (field.options ?? []).forEach((option) => {
            const optionEl = document.createElement("option");
            optionEl.value = option;
            optionEl.textContent = option;
            select.appendChild(optionEl);
          });
          select.value = String(currentValue ?? "");
          select.addEventListener("change", () => {
            updateValue(select.value);
          });
          select.addEventListener("focus", focusHandler);
          select.addEventListener("blur", blurHandler);
          cell.appendChild(select);
        } else if (field.type === "number" || field.type === "autonumber") {
          const input = document.createElement("input");
          input.type = "number";
          input.value = currentValue;
          if (field.type === "autonumber") {
            input.readOnly = true;
          } else {
            input.addEventListener("input", () => {
              updateValue(parseFieldValue(field.type, input.value));
            });
          }
          input.addEventListener("focus", focusHandler);
          input.addEventListener("blur", blurHandler);
          cell.appendChild(input);
        } else if (field.type === "date") {
          const input = document.createElement("input");
          input.type = "date";
          input.value = currentValue;
          input.addEventListener("change", () => {
            updateValue(input.value);
          });
          input.addEventListener("focus", focusHandler);
          input.addEventListener("blur", blurHandler);
          cell.appendChild(input);
        } else {
          const input = document.createElement("input");
          input.type = "text";
          input.value = currentValue;
          input.addEventListener("input", () => {
            updateValue(input.value);
          });
          input.addEventListener("focus", focusHandler);
          input.addEventListener("blur", blurHandler);
          cell.appendChild(input);
        }
        const isMissing = field.required && (currentValue === "" || currentValue === null);
        const isDuplicate =
          (field.primaryKey || field.unique) &&
          isDuplicateValue(currentValue, field.name, record.id);
        const isRuleValid = isValueValidForRule(field.validationRule, currentValue);
        cell.classList.toggle("base__cell--invalid", isMissing || isDuplicate || !isRuleValid);
        row.appendChild(cell);
      });
      tableView.appendChild(row);
    });

    const pager = document.createElement("div");
    pager.className = "base__pager";
    const info = document.createElement("span");
    info.textContent = `Page ${pageIndex + 1} of ${totalPages} (${total} records)`;
    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.textContent = "Prev";
    prevButton.disabled = pageIndex === 0;
    prevButton.addEventListener("click", () => {
      pageIndex = Math.max(0, pageIndex - 1);
      renderTableView();
    });
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.textContent = "Next";
    nextButton.disabled = pageIndex >= totalPages - 1;
    nextButton.addEventListener("click", () => {
      pageIndex = Math.min(totalPages - 1, pageIndex + 1);
      renderTableView();
    });
    pager.appendChild(prevButton);
    pager.appendChild(info);
    pager.appendChild(nextButton);
    tableView.appendChild(pager);
    main.appendChild(tableView);
    renderInspector();
  }

  toolbar.addEventListener("click", async (event) => {
    const cmd = event.target.closest("button")?.dataset.cmd;
    if (!cmd) return;
    if (cmd === "addTable") {
      if (isMobileView()) {
        await addTableWizard();
      } else {
        addTable();
      }
    }
    if (cmd === "renameTable") {
      await renameTable();
    }
    if (cmd === "deleteTable") {
      await deleteTable();
    }
    if (cmd === "addField") {
      if (isMobileView()) {
        await addFieldWizard();
      } else {
        await addField();
      }
    }
    if (cmd === "deleteField") {
      await deleteField();
    }
    if (cmd === "addRecord") {
      addRecord();
    }
    if (cmd === "deleteRecord") {
      deleteRecord();
    }
    if (cmd === "importCsv") {
      await importCsv();
    }
    if (cmd === "exportCsv") {
      exportCsv();
    }
    if (cmd === "addTableWizard") {
      await addTableWizard();
    }
    if (cmd === "addFieldWizard") {
      await addFieldWizard();
    }
  });

  toolbar.addEventListener("change", (event) => {
    const field = event.target.closest("[data-field]")?.dataset.field;
    if (!field) return;
    if (field === "sortField") {
      sortFieldName = event.target.value;
      pageIndex = 0;
      renderTableView();
    }
    if (field === "sortDirection") {
      sortDirection = event.target.value;
      pageIndex = 0;
      renderTableView();
    }
  });

  toolbar.addEventListener("input", (event) => {
    const field = event.target.closest("[data-field]")?.dataset.field;
    if (field === "filterQuery") {
      filterQuery = event.target.value;
      pageIndex = 0;
      renderTableView();
    }
  });

  sidebar.addEventListener("click", (event) => {
    const index = event.target.closest("button")?.dataset.index;
    if (index === undefined) return;
    currentTableIndex = Number(index);
    selectedRecordId = null;
    selectedField = null;
    pageIndex = 0;
    activeTab = "datasheet";
    renderTables();
    renderTableView();
    const table = doc.tables[currentTableIndex];
    if (table) {
      announce(`Selected table ${table.name}.`);
    }
  });

  registry.register({
    id: "base.addTable",
    label: "Base: New Table",
    handler: addTable
  });
  registry.register({
    id: "base.renameTable",
    label: "Base: Rename Table",
    handler: renameTable
  });
  registry.register({
    id: "base.deleteTable",
    label: "Base: Delete Table",
    handler: deleteTable
  });
  registry.register({
    id: "base.addField",
    label: "Base: Add Field",
    handler: addField
  });
  registry.register({
    id: "base.addRecord",
    label: "Base: Add Record",
    handler: addRecord
  });
  registry.register({
    id: "base.deleteRecord",
    label: "Base: Delete Record",
    handler: deleteRecord
  });

  renderTables();
  renderTableView();
  renderInspector();
  return container;
}
