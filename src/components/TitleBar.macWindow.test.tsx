// On macOS the window is a native one: the system draws the red/yellow/green
// buttons over the left end of the title bar. The app used to draw its own
// Windows-style set at the right instead, which left Mac users without a green
// button and so without fullscreen (#262). CHROME-05.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/window", () => ({
    Window: { getCurrent: () => ({ minimize: async () => {}, maximize: async () => {}, close: async () => {} }) },
}));

afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock("../utils/platform");
});

/** Render the title bar as the given kind of window sees it. */
async function renderTitleBar(macWindow: boolean, props: Record<string, unknown> = {}) {
    vi.resetModules();
    vi.doMock("../utils/platform", async (original) => ({
        ...(await original<typeof import("../utils/platform")>()),
        MAC_WINDOW: macWindow,
    }));
    const { TitleBar } = await import("./TitleBar");
    const { ThemeProvider } = await import("../context/ThemeContext");
    return render(
        <ThemeProvider>
            <TitleBar fileName="note.md" filePath="/notes/note.md" onOpenFile={() => {}} {...props} />
        </ThemeProvider>
    );
}

describe("TitleBar on a native macOS window", () => {
    it("draws no window buttons of its own", async () => {
        await renderTitleBar(true);
        expect(screen.queryByLabelText("Minimize")).toBeNull();
        expect(screen.queryByLabelText("Maximize")).toBeNull();
        expect(screen.queryByLabelText("Close")).toBeNull();
        // The rest of the bar is untouched.
        expect(screen.getByLabelText("Open file")).toBeInTheDocument();
    });

    it("leaves room at the left for the system's buttons, except in fullscreen", async () => {
        const { container, unmount } = await renderTitleBar(true);
        expect(container.querySelector("header")).toHaveStyle({ paddingLeft: "86px" });
        unmount();
        // A fullscreen window has no traffic lights to make room for.
        const full = await renderTitleBar(true, { isFullscreen: true });
        expect(full.container.querySelector("header")?.style.paddingLeft).toBe("");
    });
});

describe("TitleBar on a frameless window (Windows, Linux)", () => {
    it("still draws minimize, maximize and close, with no inset", async () => {
        const { container } = await renderTitleBar(false);
        expect(screen.getByLabelText("Minimize")).toBeInTheDocument();
        expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
        expect(screen.getByLabelText("Close")).toBeInTheDocument();
        expect(container.querySelector("header")?.style.paddingLeft).toBe("");
    });
});
