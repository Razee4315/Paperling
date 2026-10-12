import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function FontControls() {
    const { font, setFont, customFont, setCustomFont } = useTheme();
    return (
        <>
            <span data-testid="font">{font}</span>
            <span data-testid="custom-font">{customFont}</span>
            <button onClick={() => setFont("custom")}>Use custom</button>
            <button onClick={() => setCustomFont('Atkinson"; color: red')}>Set family</button>
        </>
    );
}

function AccentControls() {
    const { accent, setAccent } = useTheme();
    return (
        <>
            <span data-testid="accent">{accent}</span>
            <button onClick={() => setAccent("green")}>Use green</button>
            <button onClick={() => setAccent("default")}>Use default</button>
        </>
    );
}

describe("ThemeProvider custom font", () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute("data-font");
        document.documentElement.style.removeProperty("--font-custom");
    });

    it("persists only a sanitized family and applies the Inter fallback stack", async () => {
        render(<ThemeProvider><FontControls /></ThemeProvider>);

        fireEvent.click(screen.getByText("Use custom"));
        fireEvent.click(screen.getByText("Set family"));

        expect(screen.getByTestId("font")).toHaveTextContent("custom");
        expect(screen.getByTestId("custom-font")).toHaveTextContent("Atkinson color red");
        expect(localStorage.getItem("paperling-custom-font")).toBe("Atkinson color red");
        await waitFor(() => {
            expect(document.documentElement).toHaveAttribute("data-font", "custom");
            expect(document.documentElement.style.getPropertyValue("--font-custom"))
                .toBe('"Atkinson color red", \'Inter\'');
        });
    });
});

describe("ThemeProvider accent", () => {
    beforeEach(() => {
        cleanup();
        localStorage.clear();
        document.documentElement.removeAttribute("data-theme");
        ["--accent", "--accent-hover", "--accent-text"].forEach((p) =>
            document.documentElement.style.removeProperty(p)
        );
    });

    it("persists the choice and overrides the accent variables", async () => {
        render(<ThemeProvider><AccentControls /></ThemeProvider>);

        fireEvent.click(screen.getByText("Use green"));

        expect(screen.getByTestId("accent")).toHaveTextContent("green");
        expect(localStorage.getItem("paperling-accent")).toBe("green");
        await waitFor(() => {
            expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#22c55e");
            // Hover keeps the same hue at reduced opacity.
            expect(document.documentElement.style.getPropertyValue("--accent-hover"))
                .toBe("rgba(34, 197, 94, 0.85)");
            // Green's WCAG luminance (~0.41) is above the 0.35 threshold,
            // so ink on accent-filled buttons is dark, like Material's.
            expect(document.documentElement.style.getPropertyValue("--accent-text")).toBe("#0a0a0a");
        });
    });

    it("removes the overrides when returning to the theme default", async () => {
        localStorage.setItem("paperling-accent", "amber");
        render(<ThemeProvider><AccentControls /></ThemeProvider>);

        await waitFor(() => {
            expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#f59e0b");
        });

        fireEvent.click(screen.getByText("Use default"));
        await waitFor(() => {
            expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
        });
        expect(localStorage.getItem("paperling-accent")).toBe("default");
    });

    it("ignores a corrupted stored accent and falls back to default", () => {
        localStorage.setItem("paperling-accent", "chartreuse");
        render(<ThemeProvider><AccentControls /></ThemeProvider>);
        expect(screen.getByTestId("accent")).toHaveTextContent("default");
    });
});

function ThemeControls() {
    const { theme, setTheme, followSystem, setFollowSystem, zoom, zoomBy, resetZoom } = useTheme();
    return (
        <>
            <span data-testid="theme">{theme}</span>
            <span data-testid="follow">{String(followSystem)}</span>
            <span data-testid="zoom">{zoom}</span>
            <button onClick={() => setTheme("nord")}>Use nord</button>
            <button onClick={() => setFollowSystem(true)}>Follow system</button>
            <button onClick={() => zoomBy(1)}>Zoom in</button>
            <button onClick={resetZoom}>Reset zoom</button>
        </>
    );
}

describe("ThemeProvider system theme and zoom", () => {
    let listeners: Array<() => void> = [];
    let dark = false;
    const originalMatchMedia = window.matchMedia;
    beforeEach(() => {
        cleanup();
        localStorage.clear();
        listeners = [];
        dark = false;
        window.matchMedia = ((query: string) => ({
            get matches() { return dark; },
            media: query,
            addEventListener: (_: string, fn: () => void) => { listeners.push(fn); },
            removeEventListener: (_: string, fn: () => void) => { listeners = listeners.filter((l) => l !== fn); },
        })) as unknown as typeof window.matchMedia;
        return () => { window.matchMedia = originalMatchMedia; };
    });

    it("follows the OS on a first run and switches live when it changes (THEME-01)", async () => {
        dark = true;
        render(<ThemeProvider><ThemeControls /></ThemeProvider>);
        expect(screen.getByTestId("follow")).toHaveTextContent("true");
        expect(screen.getByTestId("theme")).toHaveTextContent("graphite");
        dark = false;
        await waitFor(() => expect(listeners.length).toBe(1));
        act(() => listeners.forEach((fn) => fn()));
        expect(screen.getByTestId("theme")).toHaveTextContent("paper");
    });

    it("stops following once a theme is picked, and can be turned back on (THEME-01)", () => {
        dark = true;
        render(<ThemeProvider><ThemeControls /></ThemeProvider>);
        fireEvent.click(screen.getByText("Use nord"));
        expect(screen.getByTestId("follow")).toHaveTextContent("false");
        expect(screen.getByTestId("theme")).toHaveTextContent("nord");
        expect(localStorage.getItem("paperling-theme")).toBe("nord");
        fireEvent.click(screen.getByText("Follow system"));
        expect(screen.getByTestId("theme")).toHaveTextContent("graphite");
        expect(localStorage.getItem("paperling-theme")).toBe("system");
    });

    it("keeps a saved theme regardless of the OS (THEME-01)", () => {
        dark = true;
        localStorage.setItem("paperling-theme", "paper");
        render(<ThemeProvider><ThemeControls /></ThemeProvider>);
        expect(screen.getByTestId("follow")).toHaveTextContent("false");
        expect(screen.getByTestId("theme")).toHaveTextContent("paper");
    });

    it("steps, persists and applies the zoom (ZOOM-01)", async () => {
        render(<ThemeProvider><ThemeControls /></ThemeProvider>);
        fireEvent.click(screen.getByText("Zoom in"));
        expect(screen.getByTestId("zoom")).toHaveTextContent("1.1");
        expect(localStorage.getItem("paperling-zoom")).toBe("1.1");
        await waitFor(() => expect(document.documentElement.style.getPropertyValue("--zoom")).toBe("1.1"));
        fireEvent.click(screen.getByText("Reset zoom"));
        expect(screen.getByTestId("zoom")).toHaveTextContent("1");
    });
});
