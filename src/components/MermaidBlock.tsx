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
const svgCache = new Map<string, string>();
const SVG_CACHE_CAP = 64;

let nextMermaidId = 0;

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
function parseNaturalWidth(svg: string): number {
    const root = svg.match(
        /<svg[^>]*viewBox="\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s*"/,
    );
    const w = root ? parseFloat(root[3]) : NaN;
    if (!Number.isFinite(w) || w <= 0) return 768;
    return w;
}

/**
 * The interactive surface a rendered diagram lives in: fit-to-natural-size by
 * default (the old CSS stretched every diagram to the full column width, so a
 * four-node flowchart filled the screen), ctrl+wheel zoom, drag-to-pan while
 * zoomed, double-click to toggle 1x/2x, and a hover toolbar with zoom out /
 * percentage-reset / zoom in. The fullscreen entry button lives on the block.
 */
function MermaidView({ svg }: { svg: string }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const [containerW, setContainerW] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

    // Track the viewport width so "fit" can cap a small diagram at its natural
    // size instead of stretching to the column.
    useLayoutEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const update = () => setContainerW(el.clientWidth);
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

    const naturalW = parseNaturalWidth(svg);
    const fitWidth = containerW > 0 ? Math.min(naturalW, containerW) : naturalW;
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
        </div>
    );

    return (
        <div
            ref={viewportRef}
            className={`relative group w-full overflow-auto ${dragging ? "cursor-grabbing select-none" : zoom > 1 ? "cursor-grab" : ""}`}
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
            <div className="mermaid-sizer mx-auto" style={{ width }}>
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
    const fsTriggerRef = useRef<HTMLButtonElement>(null);
    const idRef = useRef<string>(`paperling-mermaid-${++nextMermaidId}`);

    useEffect(() => {
        let cancelled = false;
        setError(null);
        const mermaidTheme = themeToMermaid(theme);
        // \u0000 separator: can never occur in a theme name, so theme+code
        // pairs can't collide across themes.
        const cacheKey = `${mermaidTheme}\u0000${code}`;
        const cached = svgCache.get(cacheKey);
        if (cached !== undefined) {
            setSvg(cached);
            return;
        }
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
                return mermaid.render(idRef.current, code);
            })
            .then((result) => {
                if (cancelled) return;
                svgCache.set(cacheKey, result.svg);
                if (svgCache.size > SVG_CACHE_CAP) {
                    const oldest = svgCache.keys().next().value;
                    if (oldest !== undefined) svgCache.delete(oldest);
                }
                setSvg(result.svg);
            })
            .catch((err: unknown) => {
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
            fsTriggerRef.current?.focus();
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
            <div className="relative my-4 group">
                <MermaidView svg={svg} />
                <button
                    ref={fsTriggerRef}
                    type="button"
                    aria-label="View diagram fullscreen"
                    title="Fullscreen diagram"
                    className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]/95 shadow-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation();
                        setFullscreen(true);
                    }}
                >
                    <span className="material-symbols-outlined text-[16px]">open_in_full</span>
                </button>
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
                                <MermaidView svg={svg} />
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
