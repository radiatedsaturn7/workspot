export function snapshotDocument(doc) {
  return JSON.parse(
    JSON.stringify(doc, (key, value) => (typeof value === "function" ? undefined : value))
  );
}

export function createHistory(getSnapshot, { limit = 50 } = {}) {
  const undoStack = [getSnapshot()];
  const redoStack = [];
  let lastRecordTime = 0;
  let lastBatchKey = null;
  let isApplying = false;

  const record = ({ batchKey = "input", delay = 700 } = {}) => {
    if (isApplying) return;
    const snapshot = getSnapshot();
    const now = Date.now();
    if (
      undoStack.length &&
      batchKey &&
      batchKey === lastBatchKey &&
      now - lastRecordTime < delay
    ) {
      undoStack[undoStack.length - 1] = snapshot;
    } else {
      undoStack.push(snapshot);
      if (undoStack.length > limit) {
        undoStack.shift();
      }
      lastBatchKey = batchKey;
    }
    lastRecordTime = now;
    redoStack.length = 0;
  };

  const applySnapshot = (snapshot, handler) => {
    isApplying = true;
    handler(snapshot);
    isApplying = false;
  };

  const undo = (handler) => {
    if (undoStack.length < 2) return;
    const current = undoStack.pop();
    redoStack.push(current);
    applySnapshot(undoStack[undoStack.length - 1], handler);
  };

  const redo = (handler) => {
    if (!redoStack.length) return;
    const snapshot = redoStack.pop();
    undoStack.push(snapshot);
    applySnapshot(snapshot, handler);
  };

  const canUndo = () => undoStack.length > 1;
  const canRedo = () => redoStack.length > 0;

  return {
    record,
    undo,
    redo,
    canUndo,
    canRedo
  };
}
