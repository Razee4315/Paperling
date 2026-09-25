import { useEffect, useLayoutEffect, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../context/ThemeContext";

// Single shared mermaid module promise — loaded only on first use.
let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;

const loadMermaid = (): Promise<typeof import("mermaid")["default"]> => {
    if (mermaidPromise) return mermaidPromise;
    mermaidPromise = import("mermaid").then((m) => {
        const mermaid = m.default;
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict", // disallow embedded scripts
            theme: "dark",
            fontFamily: "var(--font-body)",
        });
        return mermaid;
    });
    return mermaidPromise;
};

// Map the app theme to the closest built-in mermaid theme so diagrams match the
// surrounding UI. Dracula is a dark theme (was getting the light "default"), and
// Paper's warm light tone reads better with mermaid's softer "neutral" than the
// stark "default". PREVIEW-03.
const themeToMermaid = (t: string): "default" | "dark" | "neutral" => {
    switch (t) {
        case "paper":
            return "neutral";
        case "light":
            return "default";
        // Every dark theme — including the newer Graphite/Nord/Midnight —
        // must map to mermaid's dark palette. Falling through to "default"
        // rendered light-theme text (near-black labels/legends) directly on
        // the app's dark background, where it was unreadable (MMV-02).
        default:
            return "dark";
    }
};

// Cache rendered SVG keyed by theme + source. Without this, a doc re-renders
// (every debounce tick, or when react-markdown remounts the block because blocks
// above it changed height while typing) re-run mermaid.render() — a full SVG
// layout pass — for diagrams the user never touched. Cache hits are instant.
// Bounded LRU-ish: evict the oldest when over the cap. PREVIEW-03.
// Each entry remembers the element id it was rendered with, because mermaid
// bakes that id into the SVG (root id, scoped <style>, marker/gradient refs).
// Serving one cached string to two blocks put two elements with the same id
// on the page, and arrowheads/styles resolved to the wrong copy. MMV-06.
const svgCache = new Map<string, { svg: string; id: string }>();
const SVG_CACHE_CAP = 64;

let nextMermaidId = 0;
// Ids are "mmd<N>z": the trailing delimiter guarantees no id is a substring of
// another (mmd1z vs mmd12z), so a textual id swap can't corrupt a longer one.
const newMermaidId = () => `mmd${++nextMermaidId}z`;

/** Re-key an SVG rendered under `fromId` to `toId` (ids are unique tokens). */
export function rekeySvg(svg: string, fromId: string, toId: string): string {
    return fromId === toId ? svg : svg.split(fromId).join(toId);
}

/** Mermaid appends a temporary `#d<id>` container (plus, on some versions, the
 *  `#<id>` element itself) to <body> and leaves it behind when rendering
 *  fails — one stray node + stylesheet per failed keystroke. MMV-05. */
function removeRenderLeftovers(id: string) {
    document.getElementById(`d${id}`)?.remove();
    const el = document.getElementById(id);
    if (el && !el.closest(".mermaid-rendered")) el.remove();
}

interface MermaidBlockProps {
    code: string;
}

/* ---------- Viewer: zoom / pan / fit / fullscreen (MMV-01) ---------- */

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/**
 * Natural width from the ROOT svg's viewBox. Mermaid diagrams carry
 * viewBox="min-x min-y width height" (e.g. "4 4 641.4 190") on the root tag,
 * but the string also contains nested defs/markers with their OWN tiny
 * viewBoxes — so the parse must anchor to the first <svg …> tag, not the first
 * viewBox anywhere in the markup (that pegged every diagram to an 80px floor).
 */
function parseNaturalSize(svg: string): { w: number; h: number } {
    const root = svg.match(
        /<svg[^>]*viewBox="\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s*"/,
    );
    const w = root ? parseFloat(root[3]) : NaN;
    const h = root ? parseFloat(root[4]) : NaN;
    return {
        w: Number.isFinite(w) && w > 0 ? w : 768,
        h: Number.isFinite(h) && h > 0 ? h : 432,
    };
}

/**
 * The interactive surface a rendered diagram lives in: fit-to-natural-size by
 * default (the old CSS stretched every diagram to the full column width, so a
 * four-node flowchart filled the screen), ctrl+wheel zoom, drag-to-pan while
 * zoomed, double-click to toggle 1x/2x, and a hover toolbar with zoom out /
 * percentage-reset / zoom in. The fullscreen entry button lives on the block.
 */
function MermaidView({
    svg,
    onFullscreen,
    contain = false,
}: {
    svg: string;
    /** Shows the fullscreen button inside the toolbar (inline view only). */
    onFullscreen?: () => void;
    /** Fullscreen: fit BOTH axes and allow scaling up, so a small diagram
     *  fills the screen and a tall one fits without scrolling. */
    contain?: boolean;
}) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const [containerW, setContainerW] = useState(0);
    const [containerH, setContainerH] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

    // Track the viewport width so "fit" can cap a small diagram at its natural
    // size instead of stretching to the column.
    useLayoutEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const update = () => {
            setContainerW(el.clientWidth);
            setContainerH(el.clientHeight);
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // ctrl+wheel zoom. React's onWheel is passive, so preventDefault needs a
    // manual non-passive listener. Plain wheel keeps scrolling the page.
    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    const natural = parseNaturalSize(svg);
    const naturalW = natural.w;
    const fitWidth = contain && containerW > 0 && containerH > 0
        ? Math.min(containerW - 16, (containerH - 16) * (natural.w / natural.h))
        : containerW > 0 ? Math.min(naturalW, containerW) : naturalW;
    const width = Math.max(80, Math.round(fitWidth * zoom));

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (zoom <= 1) return;
        const el = viewportRef.current;
        if (!el) return;
        dragRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
        el.setPointerCapture(e.pointerId);
        setDragging(true);
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        const el = viewportRef.current;
        if (!d || !el) return;
        el.scrollLeft = d.sl - (e.clientX - d.x);
        el.scrollTop = d.st - (e.clientY - d.y);
    };
    const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDragging(false);
        viewportRef.current?.releasePointerCapture(e.pointerId);
    };

    const toolbar = (
        <div
            className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]/95 shadow-lg p-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
            role="toolbar"
            aria-label="Diagram controls"
        >
            <button
                type="button"
                aria-label="Zoom out"
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => setZoom((z) => clampZoom(z / 1.25))}
            >
                <span className="material-symbols-outlined text-[18px]">remove</span>
            </button>
            <button
                type="button"
                aria-label="Reset zoom"
                title="Reset zoom (100%)"
                className="h-7 px-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] min-w-[44px]"
                onClick={() => setZoom(1)}
            >
                {Math.round(zoom * 100)}%
            </button>
            <button
                type="button"
                aria-label="Zoom in"
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => setZoom((z) => clampZoom(z * 1.25))}
            >
                <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
            {/* Fullscreen lives INSIDE the toolbar. It used to be a separate
                absolutely-positioned button at the same top-right spot, laid
                exactly over "Zoom in" — clicking + opened fullscreen. MMV-04. */}
            {onFullscreen && (
                <button
                    type="button"
                    aria-label="View diagram fullscreen"
                    title="Fullscreen diagram"
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    onClick={(e) => {
                        e.stopPropagation();
                        onFullscreen();
                    }}
                >
                    <span className="material-symbols-outlined text-[16px]">open_in_full</span>
                </button>
            )}
        </div>
    );

    return (
        <div
            ref={viewportRef}
            // Focusable so the diagram can be zoomed from the keyboard:
            // + / - step, 0 resets (the toolbar is also reachable by Tab).
            tabIndex={0}
            aria-label="Diagram — press + or - to zoom, 0 to reset"
            onKeyDown={(e) => {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom((z) => clampZoom(z * 1.25)); }
                else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom((z) => clampZoom(z / 1.25)); }
                else if (e.key === "0") { e.preventDefault(); setZoom(1); }
            }}
            className={`relative group w-full ${contain ? "h-full flex flex-col" : ""} overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-md ${dragging ? "cursor-grabbing select-none" : zoom > 1 ? "cursor-grab" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => {
                // Ignore double clicks on the toolbar/buttons — two rapid
                // clicks on a zoom control are a dblclick to the viewport,
                // and the 2x toggle then fought the stepped zoom (zoom out
                // twice -> snap to 200%). MMV-03.
                if ((e.target as HTMLElement).closest('[role="toolbar"], button')) return;
                setZoom((z) => (z > 1 ? 1 : 2));
            }}
        >
            {toolbar}
            <div className={`mermaid-sizer mx-auto ${contain ? "my-auto" : ""}`} style={{ width }}>
                {/* mermaid output is from our own module (securityLevel: strict) — safe to inject as HTML */}
                <div
                    className="mermaid-rendered flex justify-center"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            </div>
        </div>
    );
}

function MermaidBlockImpl({ code }: MermaidBlockProps) {
    // Subscribe to the app theme so diagrams re-render on light/dark switches —
    // previously mermaid.initialize ran once for the app lifetime, so existing
    // diagrams kept their original theme after a switch. PREVIEW-03.
    const { theme } = useTheme();
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fullscreen, setFullscreen] = useState(false);
    const fsCloseRef = useRef<HTMLButtonElement>(null);
    // Focus returns here (the diagram's wrapper) when fullscreen closes.
    const fsTriggerRef = useRef<HTMLDivElement>(null);
    const idRef = useRef<string>(newMermaidId());

    useEffect(() => {
        let cancelled = false;
        setError(null);
        const mermaidTheme = themeToMermaid(theme);
        // \u0000 separator: can never occur in a theme name, so theme+code
        // pairs can't collide across themes.
        const cacheKey = `${mermaidTheme}\u0000${code}`;
        const cached = svgCache.get(cacheKey);
        if (cached !== undefined) {
            setSvg(rekeySvg(cached.svg, cached.id, idRef.current));
            return;
        }
        // A fresh id per ATTEMPT: after a failed render mermaid can leave an
        // element with the old id behind, and re-rendering under a live id
        // is exactly what produces duplicate-id collisions.
        idRef.current = newMermaidId();
        const renderId = idRef.current;
        loadMermaid()
            .then((mermaid) => {
                // Re-apply theme before rendering so diagrams follow the active
                // theme. initialize() is global, but the app theme is uniform so
                // concurrent blocks all want the same value.
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "strict",
                    theme: mermaidTheme,
                    fontFamily: "var(--font-body)",
                });
                return mermaid.render(renderId, code);
            })
            .then((result) => {
                if (cancelled) return;
                svgCache.set(cacheKey, { svg: result.svg, id: renderId });
                if (svgCache.size > SVG_CACHE_CAP) {
                    const oldest = svgCache.keys().next().value;
                    if (oldest !== undefined) svgCache.delete(oldest);
                }
                setSvg(result.svg);
            })
            .catch((err: unknown) => {
                removeRenderLeftovers(renderId);
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : "Diagram failed to render";
                setError(msg);
            });
        return () => { cancelled = true; };
    }, [code, theme]);

    // Fullscreen lifecycle: Escape exits, focus moves to the close button and
    // back to the trigger on close.
    useEffect(() => {
        if (!fullscreen) return;
        fsCloseRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setFullscreen(false);
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => {
            document.removeEventListener("keydown", onKey, true);
            fsTriggerRef.current?.querySelector<HTMLElement>('[aria-label="View diagram fullscreen"]')?.focus();
        };
    }, [fullscreen]);

    if (error) {
        return (
            <div className="my-4 p-4 border border-[var(--danger)] rounded-lg bg-[var(--bg-secondary)]">
                <div className="text-sm font-semibold text-[var(--danger)] mb-1">Mermaid error</div>
                <div className="text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap">{error}</div>
                <pre className="mt-2 text-xs opacity-70 overflow-x-auto">{code}</pre>
            </div>
        );
    }

    if (!svg) {
        return (
            <div className="my-4 p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-secondary)] animate-pulse text-xs text-[var(--text-muted)] text-center">
                Rendering diagram…
            </div>
        );
    }

    return (
        <>
            <div className="relative my-4 group" ref={fsTriggerRef}>
                <MermaidView svg={svg} onFullscreen={() => setFullscreen(true)} />
            </div>
            {fullscreen &&
                createPortal(
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Diagram fullscreen view"
                        className="fixed inset-0 z-[220] bg-black/80 flex items-center justify-center p-4 md:p-10"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setFullscreen(false);
                        }}
                    >
                        <div className="relative w-full max-w-[95vw] h-full max-h-[92vh] bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
                            <div className="absolute top-3 right-3 z-20 flex items-center gap-1">
                                <button
                                    ref={fsCloseRef}
                                    type="button"
                                    aria-label="Close fullscreen diagram"
                                    className="w-8 h-8 flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                                    onClick={() => setFullscreen(false)}
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            </div>
                            <div className="w-full h-full p-2">
                                {/* Same SVG, re-keyed: two copies with one id
                                    would share markers/styles. MMV-06. */}
                                <MermaidView svg={rekeySvg(svg, idRef.current, `${idRef.current}fs`)} contain />
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}

// Memoized so a parent re-render with unchanged `code` skips re-running the
// effect entirely (the cache covers remounts; memo covers same-position renders).
export const MermaidBlock = memo(MermaidBlockImpl);

/** Quick check used in the components map to short-circuit normal code rendering. */
export const isMermaidLanguage = (className: string | undefined): boolean =>
    typeof className === "string" && /\blanguage-mermaid\b/.test(className);
