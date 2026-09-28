import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

/**
 * Diagram export for rendered Mermaid SVGs (MMV-07): copy as PNG to the
 * clipboard (paste straight into chat/docs/slides) or save as .svg.
 *
 * Mermaid's inline SVG is sized by the page (width="100%", max-width style)
 * and its <style> refers to the app's CSS variables. A standalone copy gets
 * explicit pixel dimensions from its viewBox and a solid background, so it
 * looks the same outside the app.
 */

function notify(message: string, type: "success" | "error" | "info") {
    window.dispatchEvent(new CustomEvent("paperling:notify", { detail: { message, type } }));
}

/** Standalone SVG markup plus its natural size. */
export function standaloneSvg(svg: string, background: string): { markup: string; width: number; height: number } {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    const vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    const width = Number.isFinite(vb[2]) && vb[2] > 0 ? vb[2] : 800;
    const height = Number.isFinite(vb[3]) && vb[3] > 0 ? vb[3] : 450;
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    root.removeAttribute("style");
    if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Resolve the page font variable the diagram's <style> uses.
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim() || "sans-serif";
    const markup = new XMLSerializer()
        .serializeToString(root)
        .replace(/var\(--font-body\)/g, font.replace(/"/g, "'"));
    // Background as the first child so transparent areas aren't black/clear.
    const withBg = markup.replace(
        /(<svg[^>]*>)/,
        `$1<rect x="${vb[0] || 0}" y="${vb[1] || 0}" width="100%" height="100%" fill="${background}"/>`,
    );
    return { markup: withBg, width, height };
}

function pageBackground(): string {
    return getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim() || "#ffffff";
}

/** Rasterise the diagram at 2x and put it on the clipboard as PNG. */
export async function copyDiagramAsPng(svg: string): Promise<void> {
    try {
        const { markup, width, height } = standaloneSvg(svg, pageBackground());
        const scale = 2;
        const img = new Image();
        const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Could not rasterise the diagram"));
            img.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not encode PNG");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        notify("Diagram copied as PNG", "success");
    } catch (err) {
        notify(err instanceof Error ? `Copy failed: ${err.message}` : "Copy failed", "error");
    }
}

/** Save the diagram as a standalone .svg file. */
export async function saveDiagramSvg(svg: string, baseName: string): Promise<void> {
    try {
        const { markup } = standaloneSvg(svg, pageBackground());
        const data = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${markup}`);
        if (!isTauri()) {
            // Browser dev shell: plain download.
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([data], { type: "image/svg+xml" }));
            a.download = `${baseName}.svg`;
            a.click();
            URL.revokeObjectURL(a.href);
            return;
        }
        const path = await save({ defaultPath: `${baseName}.svg`, filters: [{ name: "SVG image", extensions: ["svg"] }] });
        if (!path) return;
        await invoke("write_export_file", { path, data: Array.from(data) });
        notify("Diagram saved as SVG", "success");
    } catch (err) {
        notify(err instanceof Error ? `Save failed: ${err.message}` : "Save failed", "error");
    }
}
