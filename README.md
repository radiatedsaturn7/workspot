# Workspot Office Suite MVP

This repository contains a JavaScript-only, offline-first Office suite MVP with Writer, Sheets, Slides, and Base workspaces. All data is stored in browser `localStorage`, and you can export/import workspaces as JSON backups.

## Getting started

```bash
npm install
npm run dev
```

## Features

- Shared shell with document library and command palette (`Ctrl/Cmd + K`).
- Settings modal with high-contrast + reduced-motion toggles.
- Writer: rich-text editing, tables, images, links, comments, find/replace.
- Sheets: editable grid with basic formula support.
- Slides: slide list, text boxes, theme toggle.
- Base: table builder with fields and records.
- Autosave with snapshot recovery stored in localStorage.

## Notes

- This MVP is offline-first and does not depend on a backend.
- JSON export/import is available from the top bar.
- See `CHECKLIST.md` for the running implementation checklist.
