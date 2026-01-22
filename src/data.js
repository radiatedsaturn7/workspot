export const APP_IDS = ["writer", "sheets", "slides", "base"];

export const DEFAULT_TEMPLATES = {
  writer: () => ({
    id: `doc_${crypto.randomUUID()}`,
    type: "writer",
    schemaVersion: 1,
    meta: {
      title: "Untitled Document",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      page: {
        size: "Letter",
        margins: { t: 72, r: 72, b: 72, l: 72 }
      }
    },
    content: [
      {
        block: "heading",
        level: 1,
        runs: [{ text: "Untitled Document", marks: [] }]
      },
      {
        block: "paragraph",
        style: "Normal",
        runs: [{ text: "Start typing...", marks: [] }]
      }
    ],
    comments: [],
    history: { snapshots: [] }
  }),
  sheets: () => ({
    id: `wb_${crypto.randomUUID()}`,
    type: "sheets",
    schemaVersion: 1,
    meta: {
      title: "Untitled Workbook",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    sheets: [
      {
        name: "Sheet1",
        grid: { rows: 50, cols: 26 },
        cells: {},
        formats: {},
        colWidths: {},
        rowHeights: {},
        namedRanges: [],
        tables: [],
        filters: [],
        conditionalFormats: [],
        dataValidations: []
      }
    ],
    calc: { mode: "auto", locale: "en-US" },
    history: { snapshots: [] }
  }),
  slides: () => ({
    id: `deck_${crypto.randomUUID()}`,
    type: "slides",
    schemaVersion: 1,
    meta: {
      title: "Untitled Deck",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      theme: "Light"
    },
    slides: [
      {
        id: `slide_${crypto.randomUUID()}`,
        title: "Title Slide",
        elements: [
          {
            id: `el_${crypto.randomUUID()}`,
            type: "text",
            x: 80,
            y: 120,
            w: 480,
            h: 80,
            text: "Title",
            style: { fontSize: 36, bold: true }
          },
          {
            id: `el_${crypto.randomUUID()}`,
            type: "text",
            x: 100,
            y: 220,
            w: 440,
            h: 60,
            text: "Subtitle",
            style: { fontSize: 20 }
          }
        ]
      }
    ],
    history: { snapshots: [] }
  }),
  base: () => ({
    id: `db_${crypto.randomUUID()}`,
    type: "base",
    schemaVersion: 1,
    meta: {
      title: "Untitled Database",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    tables: [
      {
        id: `tbl_${crypto.randomUUID()}`,
        name: "Table1",
        fields: [
          { id: `fld_${crypto.randomUUID()}`, name: "ID", type: "number" },
          { id: `fld_${crypto.randomUUID()}`, name: "Name", type: "text" }
        ],
        records: [
          { id: `rec_${crypto.randomUUID()}`, values: { ID: 1, Name: "Sample" } }
        ]
      }
    ],
    relationships: [],
    history: { snapshots: [] }
  })
};

export const TEMPLATE_CATALOG = {
  writer: [
    { id: "blank", label: "Blank", description: "Start from scratch." },
    { id: "report", label: "Report", description: "Title + intro section." }
  ],
  sheets: [
    { id: "blank", label: "Blank", description: "Empty grid." },
    { id: "budget", label: "Budget", description: "Simple monthly budget." }
  ],
  slides: [
    { id: "blank", label: "Blank", description: "Single title slide." },
    { id: "project", label: "Project", description: "Title + agenda." }
  ],
  base: [
    { id: "blank", label: "Blank", description: "Starter table." },
    { id: "contacts", label: "Contacts", description: "Contact tracker." }
  ]
};

export function createDocumentFromTemplate(appType, templateId) {
  const base = DEFAULT_TEMPLATES[appType]?.();
  if (!base) {
    return null;
  }
  if (appType === "writer" && templateId === "report") {
    base.meta.title = "Project Report";
    base.content = [
      { block: "heading", level: 1, runs: [{ text: "Project Report", marks: [] }] },
      { block: "paragraph", style: "Normal", runs: [{ text: "Summary", marks: [] }] },
      { block: "paragraph", style: "Normal", runs: [{ text: "Add details here...", marks: [] }] }
    ];
  }
  if (appType === "sheets" && templateId === "budget") {
    base.meta.title = "Monthly Budget";
    base.sheets[0].cells = {
      A1: { v: "Category", t: "s" },
      B1: { v: "Planned", t: "s" },
      C1: { v: "Actual", t: "s" },
      A2: { v: "Housing", t: "s" },
      A3: { v: "Utilities", t: "s" },
      A4: { v: "Groceries", t: "s" }
    };
  }
  if (appType === "slides" && templateId === "project") {
    base.meta.title = "Project Update";
    base.slides.push({
      id: `slide_${crypto.randomUUID()}`,
      title: "Agenda",
      elements: [
        {
          id: `el_${crypto.randomUUID()}`,
          type: "text",
          x: 80,
          y: 120,
          w: 520,
          h: 200,
          text: "• Status\n• Milestones\n• Risks",
          style: { fontSize: 22 }
        }
      ]
    });
  }
  if (appType === "base" && templateId === "contacts") {
    base.meta.title = "Contacts";
    base.tables = [
      {
        id: `tbl_${crypto.randomUUID()}`,
        name: "Contacts",
        fields: [
          { id: `fld_${crypto.randomUUID()}`, name: "Name", type: "text" },
          { id: `fld_${crypto.randomUUID()}`, name: "Email", type: "text" },
          { id: `fld_${crypto.randomUUID()}`, name: "Company", type: "text" }
        ],
        records: []
      }
    ];
  }
  base.meta.template = templateId;
  return base;
}

export function createWorkspaceIndex() {
  return {
    schemaVersion: 1,
    version: 1,
    updatedAt: new Date().toISOString(),
    documents: [],
    pinnedIds: []
  };
}

export function defaultWorkspace() {
  const writer = DEFAULT_TEMPLATES.writer();
  const sheets = DEFAULT_TEMPLATES.sheets();
  const slides = DEFAULT_TEMPLATES.slides();
  const base = DEFAULT_TEMPLATES.base();
  return {
    index: {
      schemaVersion: 1,
      version: 1,
      updatedAt: new Date().toISOString(),
      documents: [
        summarizeDocument(writer),
        summarizeDocument(sheets),
        summarizeDocument(slides),
        summarizeDocument(base)
      ],
      pinnedIds: []
    },
    documents: {
      [writer.id]: writer,
      [sheets.id]: sheets,
      [slides.id]: slides,
      [base.id]: base
    }
  };
}

export function summarizeDocument(doc) {
  return {
    id: doc.id,
    type: doc.type,
    title: doc.meta.title,
    updatedAt: doc.meta.updatedAt
  };
}

export function updateMeta(doc) {
  doc.meta.updatedAt = new Date().toISOString();
}
