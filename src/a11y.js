export function attachTouchSelectionHandles({
  container,
  getRect,
  onAdjust
}) {
  const handles = document.createElement("div");
  handles.className = "selection-handles";
  handles.setAttribute("aria-hidden", "true");
  handles.classList.add("hidden");
  const start = document.createElement("button");
  start.type = "button";
  start.className = "selection-handle selection-handle--start";
  const end = document.createElement("button");
  end.type = "button";
  end.className = "selection-handle selection-handle--end";
  handles.appendChild(start);
  handles.appendChild(end);

  const style = window.getComputedStyle(container);
  if (style.position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(handles);

  let activeHandle = null;
  let isActive = false;
  const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? true;

  const toContainerPoint = (rect) => {
    const containerRect = container.getBoundingClientRect();
    return {
      left: rect.left - containerRect.left,
      right: rect.right - containerRect.left,
      bottom: rect.bottom - containerRect.top
    };
  };

  const update = () => {
    if (!isCoarsePointer || !isActive) {
      handles.classList.add("hidden");
      return;
    }
    const rect = getRect?.();
    if (!rect) {
      handles.classList.add("hidden");
      return;
    }
    const point = toContainerPoint(rect);
    start.style.left = `${point.left}px`;
    start.style.top = `${point.bottom}px`;
    end.style.left = `${point.right}px`;
    end.style.top = `${point.bottom}px`;
    handles.classList.remove("hidden");
  };

  const setActive = (nextActive) => {
    isActive = nextActive;
    update();
  };

  const onPointerMove = (event) => {
    if (!activeHandle) return;
    const point = { x: event.clientX, y: event.clientY };
    onAdjust?.(point, activeHandle);
    update();
  };

  const onPointerUp = () => {
    activeHandle = null;
  };

  start.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activeHandle = "start";
    start.setPointerCapture(event.pointerId);
  });
  end.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activeHandle = "end";
    end.setPointerCapture(event.pointerId);
  });

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);

  const disconnect = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    handles.remove();
  };

  return { update, setActive, disconnect };
}
