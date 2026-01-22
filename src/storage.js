import { createWorkspaceIndex, defaultWorkspace, summarizeDocument } from "./data.js";

const STORAGE_VERSION = 1;
export const STORAGE_NAMESPACE = `workspot.v${STORAGE_VERSION}.core`;
const LEGACY_WORKSPACE_KEY = "workspot.workspace";
const LEGACY_DOCUMENT_PREFIX = "workspot.doc.";
const WORKSPACE_KEY = "workspace";
const DOCUMENT_PREFIX = "doc.";
const SNAPSHOT_LIMIT = 20;
const CHUNK_SIZE = 500000;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const COMPRESSION_MARKER = "workspot:compressed";
const IMPORT_ID_PREFIX = {
  writer: "doc",
  sheets: "wb",
  slides: "deck",
  base: "db"
};

const storage = createStorageAdapter({ namespace: STORAGE_NAMESPACE });

function cloneDocument(doc) {
  if (typeof structuredClone === "function") {
    return structuredClone(doc);
  }
  return JSON.parse(JSON.stringify(doc));
}

function createStorageAdapter({ namespace }) {
  const prefix = `${namespace}.`;
  const metaSuffix = ".__meta";
  const chunkPrefix = ".__chunk.";

  const buildKey = (key) => `${prefix}${key}`;

  const computeChecksum = (value) => {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 33) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  };

  const readChunked = (key) => {
    const metaRaw = localStorage.getItem(`${key}${metaSuffix}`);
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    if (!meta?.chunked || !meta.chunks) return null;
    const parts = [];
    for (let i = 0; i < meta.chunks; i += 1) {
      const part = localStorage.getItem(`${key}${chunkPrefix}${i}`);
      if (part === null) {
        throw new Error("Missing chunk");
      }
      if (meta.checksums?.[i] && meta.checksums[i] !== computeChecksum(part)) {
        throw new Error("Chunk checksum mismatch");
      }
      parts.push(part);
    }
    return parts.join("");
  };

  const clearChunks = (key) => {
    const metaRaw = localStorage.getItem(`${key}${metaSuffix}`);
    if (!metaRaw) return;
    try {
      const meta = JSON.parse(metaRaw);
      if (meta?.chunks) {
        for (let i = 0; i < meta.chunks; i += 1) {
          localStorage.removeItem(`${key}${chunkPrefix}${i}`);
        }
      }
    } catch (error) {
      // ignore malformed meta
    }
    localStorage.removeItem(`${key}${metaSuffix}`);
  };

  return {
    get(key) {
      const namespacedKey = buildKey(key);
      const value = localStorage.getItem(namespacedKey);
      if (value !== null) return value;
      return readChunked(namespacedKey);
    },
    set(key, value) {
      const namespacedKey = buildKey(key);
      clearChunks(namespacedKey);
      if (value.length <= CHUNK_SIZE) {
        localStorage.setItem(namespacedKey, value);
        return;
      }
      localStorage.removeItem(namespacedKey);
      const chunks = Math.ceil(value.length / CHUNK_SIZE);
      const checksums = [];
      for (let i = 0; i < chunks; i += 1) {
        const part = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        localStorage.setItem(`${namespacedKey}${chunkPrefix}${i}`, part);
        checksums.push(computeChecksum(part));
      }
      localStorage.setItem(
        `${namespacedKey}${metaSuffix}`,
        JSON.stringify({ chunked: true, chunks, checksums })
      );
    },
    remove(key) {
      const namespacedKey = buildKey(key);
      localStorage.removeItem(namespacedKey);
      clearChunks(namespacedKey);
    },
    listKeys() {
      const keys = new Set();
      for (let i = 0; i < localStorage.length; i += 1) {
        const rawKey = localStorage.key(i);
        if (!rawKey || !rawKey.startsWith(prefix)) continue;
        const trimmed = rawKey.slice(prefix.length);
        if (trimmed.endsWith(metaSuffix)) {
          keys.add(trimmed.replace(metaSuffix, ""));
          continue;
        }
        const chunkIndex = trimmed.indexOf(chunkPrefix);
        if (chunkIndex !== -1) {
          keys.add(trimmed.slice(0, chunkIndex));
          continue;
        }
        keys.add(trimmed);
      }
      return Array.from(keys);
    },
    namespace
  };
}

function getLegacyDocumentKey(docId) {
  return `${LEGACY_DOCUMENT_PREFIX}${docId}`;
}

function getDocumentKey(docId) {
  return `${DOCUMENT_PREFIX}${docId}`;
}

function getSnapshotKey(docId) {
  return `${DOCUMENT_PREFIX}${docId}.snapshots`;
}

function migrateDocument(doc) {
  const migrated = { ...doc };
  migrated.schemaVersion = doc.schemaVersion ?? 1;
  migrated.meta = migrated.meta ?? {};
  migrated.meta.title = migrated.meta.title ?? "Untitled";
  migrated.meta.updatedAt = migrated.meta.updatedAt ?? new Date().toISOString();
  migrated.meta.createdAt = migrated.meta.createdAt ?? migrated.meta.updatedAt;
  return migrated;
}

function migrateWorkspaceIndex(index) {
  const migrated = { ...index };
  migrated.schemaVersion = index.schemaVersion ?? 1;
  migrated.documents = Array.isArray(migrated.documents) ? migrated.documents : [];
  migrated.pinnedIds = migrated.pinnedIds ?? [];
  return migrated;
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function encodeBase64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64(value) {
  return decodeURIComponent(escape(atob(value)));
}

function normalizeWorkspacePayload(payload) {
  if (typeof payload === "string" && payload.length > MAX_IMPORT_BYTES) {
    throw new Error("Workspace file too large");
  }
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (parsed?.compressed === true && parsed?.payload) {
    if (typeof parsed.payload !== "string") {
      throw new Error("Invalid workspace file");
    }
    if (parsed.payload.length > MAX_IMPORT_BYTES) {
      throw new Error("Workspace file too large");
    }
    const decoded = decodeBase64(parsed.payload);
    return normalizeWorkspacePayload(decoded);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid workspace file");
  }
  if (!parsed.index || !parsed.documents) {
    throw new Error("Invalid workspace file");
  }
  if (!Array.isArray(parsed.index.documents)) {
    parsed.index.documents = [];
  }
  if (!parsed.index.pinnedIds) {
    parsed.index.pinnedIds = [];
  }
  if (typeof parsed.documents !== "object" || Array.isArray(parsed.documents)) {
    throw new Error("Invalid workspace file");
  }
  for (const doc of Object.values(parsed.documents)) {
    if (!doc?.id || typeof doc.id !== "string" || !doc.type) {
      throw new Error("Invalid workspace file");
    }
  }
  parsed.index = migrateWorkspaceIndex(parsed.index);
  return parsed;
}

function createImportedId(type) {
  const prefix = IMPORT_ID_PREFIX[type] ?? "doc";
  return `${prefix}_${crypto.randomUUID()}`;
}

export function loadWorkspace() {
  const indexRaw = storage.get(WORKSPACE_KEY) ?? localStorage.getItem(LEGACY_WORKSPACE_KEY);
  if (!indexRaw) {
    const seeded = defaultWorkspace();
    saveWorkspaceIndex(seeded.index);
    for (const doc of Object.values(seeded.documents)) {
      saveDocument(doc, { snapshot: true });
    }
    return seeded;
  }
  try {
    const index = migrateWorkspaceIndex(JSON.parse(indexRaw));
    const documents = {};
    for (const entry of index.documents) {
      const docRaw =
        storage.get(getDocumentKey(entry.id)) ??
        localStorage.getItem(getLegacyDocumentKey(entry.id));
      if (!docRaw) {
        const recovered = recoverDocument(entry.id);
        if (recovered) {
          documents[entry.id] = recovered;
        }
        continue;
      }
      try {
        documents[entry.id] = migrateDocument(JSON.parse(docRaw));
      } catch (error) {
        const recovered = recoverDocument(entry.id);
        if (recovered) {
          documents[entry.id] = recovered;
        }
      }
    }
    saveWorkspaceIndex(index);
    for (const doc of Object.values(documents)) {
      saveDocument(doc);
    }
    return { index, documents };
  } catch (error) {
    const seeded = defaultWorkspace();
    saveWorkspaceIndex(seeded.index);
    for (const doc of Object.values(seeded.documents)) {
      saveDocument(doc, { snapshot: true });
    }
    return seeded;
  }
}

export function saveWorkspaceIndex(index) {
  storage.set(WORKSPACE_KEY, JSON.stringify(migrateWorkspaceIndex(index)));
}

export function saveDocument(doc, { snapshot = false } = {}) {
  const payload = JSON.stringify(migrateDocument(doc));
  storage.set(getDocumentKey(doc.id), payload);
  if (snapshot) {
    persistSnapshot(doc.id, payload);
  }
}

export function persistSnapshot(docId, payload) {
  const key = getSnapshotKey(docId);
  const existing = storage.get(key) ?? localStorage.getItem(`${LEGACY_DOCUMENT_PREFIX}${docId}.snapshots`);
  const snapshots = existing ? JSON.parse(existing) : [];
  snapshots.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload
  });
  const trimmed = snapshots.slice(0, SNAPSHOT_LIMIT);
  storage.set(key, JSON.stringify(trimmed));
}

export function recoverDocument(docId) {
  const key = getSnapshotKey(docId);
  const existing = storage.get(key) ?? localStorage.getItem(`${LEGACY_DOCUMENT_PREFIX}${docId}.snapshots`);
  if (!existing) {
    return null;
  }
  const snapshots = JSON.parse(existing);
  for (const snapshot of snapshots) {
    try {
      return migrateDocument(JSON.parse(snapshot.payload));
    } catch (error) {
      continue;
    }
  }
  return null;
}

export function createDocument(index, doc) {
  const nextIndex = index ?? createWorkspaceIndex();
  if (!nextIndex.pinnedIds) {
    nextIndex.pinnedIds = [];
  }
  nextIndex.documents = [summarizeDocument(doc), ...nextIndex.documents];
  nextIndex.updatedAt = new Date().toISOString();
  saveWorkspaceIndex(nextIndex);
  saveDocument(doc, { snapshot: true });
  return nextIndex;
}

export function updateDocumentIndex(index, doc) {
  const updated = index.documents.map((entry) =>
    entry.id === doc.id ? summarizeDocument(doc) : entry
  );
  const next = {
    ...index,
    documents: updated,
    updatedAt: new Date().toISOString(),
    pinnedIds: index.pinnedIds ?? []
  };
  saveWorkspaceIndex(next);
  return next;
}

export function exportWorkspace(index, documents) {
  const normalizedIndex = migrateWorkspaceIndex(index);
  const normalizedDocuments = Object.fromEntries(
    Object.entries(documents).map(([id, doc]) => [id, migrateDocument(doc)])
  );
  const sortedPayload = JSON.stringify(
    sortValue({
      index: normalizedIndex,
      documents: normalizedDocuments
    })
  );
  if (sortedPayload.length > CHUNK_SIZE) {
    return JSON.stringify({
      marker: COMPRESSION_MARKER,
      compressed: true,
      payload: encodeBase64(sortedPayload)
    });
  }
  return sortedPayload;
}

export function analyzeWorkspaceImport(payload, currentWorkspace) {
  const parsed = normalizeWorkspacePayload(payload);
  const existingDocuments = currentWorkspace?.documents ?? {};
  const conflicts = Object.keys(parsed.documents).filter((id) => existingDocuments[id])
    .length;
  return { parsed, conflicts };
}

export function importWorkspace(payload, currentWorkspace, { conflictStrategy = "copy" } = {}) {
  const parsed = normalizeWorkspacePayload(payload);
  const baseIndex = currentWorkspace?.index ?? createWorkspaceIndex();
  const baseDocuments = currentWorkspace?.documents ?? {};
  const existingEntries = [...(baseIndex.documents ?? [])];
  const newEntries = [];
  const nextDocuments = { ...baseDocuments };
  const now = new Date().toISOString();
  const pinnedIds = new Set(baseIndex.pinnedIds ?? []);
  const importedPinned = new Set(parsed.index.pinnedIds ?? []);

  for (const doc of Object.values(parsed.documents)) {
    if (!doc?.id || !doc.type) {
      throw new Error("Invalid workspace file");
    }
    let incomingDoc = migrateDocument(cloneDocument(doc));
    let targetId = incomingDoc.id;

    if (nextDocuments[targetId]) {
      if (conflictStrategy === "copy") {
        targetId = createImportedId(incomingDoc.type);
        incomingDoc.id = targetId;
        incomingDoc.meta = {
          ...incomingDoc.meta,
          title: `${incomingDoc.meta?.title ?? "Untitled"} (Imported Copy)`,
          createdAt: now,
          updatedAt: now
        };
      } else {
        incomingDoc.meta = {
          ...incomingDoc.meta,
          updatedAt: now
        };
      }
    } else {
      incomingDoc.meta = {
        ...incomingDoc.meta,
        createdAt: incomingDoc.meta?.createdAt ?? now,
        updatedAt: incomingDoc.meta?.updatedAt ?? now
      };
    }

    nextDocuments[targetId] = incomingDoc;
    const summary = summarizeDocument(incomingDoc);
    const existingIndex = existingEntries.findIndex((entry) => entry.id === targetId);
    if (existingIndex >= 0) {
      existingEntries[existingIndex] = summary;
    } else {
      newEntries.push(summary);
    }
    if (importedPinned.has(doc.id)) {
      pinnedIds.add(targetId);
    }
  }

  const nextIndex = {
    ...baseIndex,
    updatedAt: now,
    documents: [...newEntries, ...existingEntries],
    pinnedIds: Array.from(pinnedIds)
  };

  saveWorkspaceIndex(nextIndex);
  for (const doc of Object.values(nextDocuments)) {
    saveDocument(doc, { snapshot: true });
  }

  return { index: nextIndex, documents: nextDocuments };
}

export function getWorkspaceStorageSummary() {
  let workspaceBytes = 0;
  const keys = [];
  const storageKeys = storage.listKeys();
  storageKeys.forEach((key) => {
    const value = storage.get(key) ?? "";
    workspaceBytes += new Blob([value]).size;
    keys.push(`${storage.namespace}.${key}`);
  });
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key === LEGACY_WORKSPACE_KEY || key.startsWith(LEGACY_DOCUMENT_PREFIX)) {
      const value = localStorage.getItem(key) ?? "";
      workspaceBytes += new Blob([value]).size;
      keys.push(key);
    }
  }
  return { workspaceBytes, keys };
}

export function clearWorkspaceStorage() {
  const { keys } = getWorkspaceStorageSummary();
  keys.forEach((key) => localStorage.removeItem(key));
  storage.listKeys().forEach((key) => storage.remove(key));
}

export function isWorkspaceStorageKey(key) {
  if (!key) return false;
  if (key === LEGACY_WORKSPACE_KEY || key.startsWith(LEGACY_DOCUMENT_PREFIX)) {
    return true;
  }
  return key.startsWith(`${STORAGE_NAMESPACE}.`);
}
