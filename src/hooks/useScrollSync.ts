import { useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createScrollSync, type Scroller } from "../utils/scrollSync";
import type { ViewMode } from "../components/ModeToggle";

export interface ScrollSyncControls {
  registerCodeScroller: (s: Scroller | null) => void;
  registerPreviewScroller: (s: Scroller | null) => void;
  onCodeScrollFraction: (f: number) => void;
  onPreviewScrollFraction: (f: number) => void;
}

const showsCode = (m: ViewMode) => m === "code" || m === "split";
const showsPreview = (m: ViewMode) => m === "preview" || m === "split";

/**
 * Bidirectional scroll sync between the editor and preview, active only in split
 * mode. One sync controller is created per app lifetime (singleton ref); the
 * register/notify callbacks are stable so wiring them into child effects doesn't
 * cause re-registration churn.
 */
export function useScrollSync(mode: ViewMode): ScrollSyncControls {
  const scrollSyncRef = useRef(createScrollSync());
  // Dev-only handle for browser-driven verification (see src/dev/fakeTauri.ts).
  if (import.meta.env.DEV) (window as unknown as { __paperlingScrollSync?: unknown }).__paperlingScrollSync = scrollSyncRef.current;

  // Enable/disable based on view mode.
  useEffect(() => {
    scrollSyncRef.current.setEnabled(mode === "split");
  }, [mode]);

  // Keep the reader's place across view-mode switches (MODE-01). The pane
  // that was on screen hands its top line to the pane being shown: reading
  // section 12 and pressing Ctrl+E opens the editor at section 12. A pane
  // that stays visible but changes width (entering/leaving split) re-anchors
  // to its own line, since the reflow would otherwise drift it.
  //
  // MODE-02: the lines are captured DURING RENDER, while the DOM still has
  // the old layout (after commit the outgoing pane is display:none and can't
  // be measured, and the last scroll-event reading can be stale after a
  // programmatic scroll). The handoff then runs in a layout effect, before
  // the browser paints: it used to run in a passive effect plus an animation
  // frame, so the first painted frame showed the editor at line 1 and the
  // next one jumped to the reading position.
  const prevModeRef = useRef(mode);
  const capturedForRef = useRef(mode);
  if (capturedForRef.current !== mode) {
    capturedForRef.current = mode;
    scrollSyncRef.current.capture("code");
    scrollSyncRef.current.capture("preview");
  }
  useLayoutEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev === mode) return;
    const sync = scrollSyncRef.current;
    if (showsCode(mode)) {
      // Entering the editor from the reader lands on the paragraph being
      // read and takes focus, so typing starts right there.
      if (!showsCode(prev)) sync.handoff("preview", "code", { focus: mode === "code" });
      else sync.handoff("code", "code");
    }
    if (showsPreview(mode)) {
      if (!showsPreview(prev)) sync.handoff("code", "preview");
      else sync.handoff("preview", "preview");
    }
  }, [mode]);

  const registerCodeScroller = useCallback(
    (s: Scroller | null) => scrollSyncRef.current.register("code", s),
    []
  );
  const registerPreviewScroller = useCallback(
    (s: Scroller | null) => scrollSyncRef.current.register("preview", s),
    []
  );
  const onCodeScrollFraction = useCallback(
    (f: number) => scrollSyncRef.current.notify("code", f),
    []
  );
  const onPreviewScrollFraction = useCallback(
    (f: number) => scrollSyncRef.current.notify("preview", f),
    []
  );

  return { registerCodeScroller, registerPreviewScroller, onCodeScrollFraction, onPreviewScrollFraction };
}
