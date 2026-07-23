/**
 * Fire `onChange` whenever `win`'s devicePixelRatio changes — including the
 * size-stable case (dragging a pop-out to a monitor with a different DPR but the
 * same CSS size), where no `resize` event fires. A `matchMedia` resolution query
 * matches only the current DPR, so it must be re-armed after each change. Returns
 * a teardown that removes the listener.
 */
export function watchDevicePixelRatio(win: Window, onChange: () => void): () => void {
  let mql: MediaQueryList | null = null;
  const handler = (): void => {
    // Re-arm BEFORE invoking onChange, so a throwing onChange can't leave the
    // watcher un-armed (silently dead for the rest of the session).
    arm();
    onChange();
  };
  const arm = (): void => {
    mql?.removeEventListener("change", handler);
    mql = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    mql.addEventListener("change", handler);
  };
  arm();
  return () => mql?.removeEventListener("change", handler);
}
