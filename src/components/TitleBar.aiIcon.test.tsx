// The AI button's shimmering icon is optional (#111): some users prefer it as
// plain text. The setting lives in localStorage and reaches the title bar
// through a window event, so both paths are covered here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

// No IPC host under jsdom; the title bar's window controls only need to exist.
vi.mock("@tauri-apps/api/window", () => ({
    Window: { getCurrent: () => ({ minimize: async () => {}, maximize: async () => {}, close: async () => {} }) },
}));

import { TitleBar } from "./TitleBar";
import { ThemeProvider } from "../context/ThemeContext";
import { setAIIconAnimation } from "../utils/persistence";

// The title bar hosts SettingsMenu, which reads the theme context. The AI button
// lives in the file-actions cluster, which only renders once a file is open, so
// supply a file too.
const renderTitleBar = (props: Parameters<typeof TitleBar>[0] = {}) =>
    render(
        <ThemeProvider>
            <TitleBar fileName="note.md" filePath="/notes/note.md" onOpenFile={() => {}} {...props} />
        </ThemeProvider>
    );

const aiIcon = () => screen.getByLabelText("AI assistant").querySelector("span.material-symbols-outlined");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("TitleBar AI icon animation", () => {
    it("shimmers by default, so the existing look is unchanged", () => {
        renderTitleBar({ onToggleAI: () => {} });
        expect(aiIcon()).toHaveClass("ai-shimmer");
    });

    it("renders plain when the setting is off", () => {
        setAIIconAnimation(false);
        renderTitleBar({ onToggleAI: () => {} });
        expect(aiIcon()).not.toHaveClass("ai-shimmer");
        // Still the same glyph, just not animated.
        expect(aiIcon()).toHaveClass("material-symbols-outlined");
    });

    it("reacts to the setting being toggled while open", () => {
        renderTitleBar({ onToggleAI: () => {} });
        expect(aiIcon()).toHaveClass("ai-shimmer");

        act(() => {
            window.dispatchEvent(
                new CustomEvent("paperling:ai-icon-animation-toggle", { detail: { enabled: false } })
            );
        });
        expect(aiIcon()).not.toHaveClass("ai-shimmer");

        act(() => {
            window.dispatchEvent(
                new CustomEvent("paperling:ai-icon-animation-toggle", { detail: { enabled: true } })
            );
        });
        expect(aiIcon()).toHaveClass("ai-shimmer");
    });

    it("still triggers the AI panel when the animation is off", () => {
        setAIIconAnimation(false);
        const onToggleAI = vi.fn();
        renderTitleBar({ onToggleAI });

        fireEvent.click(screen.getByLabelText("AI assistant"));
        expect(onToggleAI).toHaveBeenCalledTimes(1);
    });

    it("omits the AI button entirely when AI is disabled", () => {
        renderTitleBar();
        expect(screen.queryByLabelText("AI assistant")).toBeNull();
    });
});
