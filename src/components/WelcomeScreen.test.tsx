// Welcome screen Recent Files pinning (PINS-01): right-click / long-press the
// menu toggles a file between pinned and unpinned, pins float to the top, and
// each row shows a pin glyph the moment it's pinned.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { getRecentFiles, clearRecentFiles, addRecentFile } from "../utils/persistence";
import { WelcomeScreen } from "./WelcomeScreen";

// No IPC host under jsdom: existence checks always "succeed" and drag listeners
// register no-ops.
vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn().mockResolvedValue({ name: "x" }),
}));
vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
    TauriEvent: { DRAG_ENTER: "drag-enter", DRAG_LEAVE: "drag-leave", DRAG_DROP: "drag-drop" },
}));

const platform = vi.hoisted(() => ({ IS_MOBILE: false, IS_TOUCH: false }));
vi.mock("../utils/platform", () => platform);

const findMenuAction = (label: string) =>
    screen.getAllByRole("menuitem").find((el) => el.textContent?.includes(label));

beforeEach(() => clearRecentFiles());

afterEach(() => {
    cleanup();
    platform.IS_MOBILE = false;
});

const renderScreen = () =>
    render(<WelcomeScreen onOpenFile={() => {}} onFileDrop={() => {}} onOpenRecent={() => {}} />);

describe("WelcomeScreen recent files pinning", () => {
    it("offers Pin in the context menu of unpinned files", () => {
        addRecentFile("/x.md", "X.md");
        addRecentFile("/y.md", "Y.md");
        renderScreen();
        fireEvent.contextMenu(screen.getByText("Y.md"));
        const pin = findMenuAction("Pin");
        expect(pin).toBeTruthy();
        expect(pin?.textContent).toContain("Pin");
        expect(findMenuAction("Unpin")).toBeUndefined();
    });

    it("pins a file from its context menu, floats it to the top, and shows its glyph", () => {
        addRecentFile("/x.md", "X.md");
        addRecentFile("/y.md", "Y.md");
        renderScreen();
        let items = screen.getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("Y.md"); // most recent first

        fireEvent.contextMenu(screen.getByText("Y.md"));
        fireEvent.click(findMenuAction("Pin")!);

        expect(getRecentFiles()[0].path).toBe("/y.md");
        expect(getRecentFiles()[0].pinned).toBe(true);
        // The menu closes and the row now carries a pin glyph.
        expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
        expect(screen.getAllByText("push_pin")).toHaveLength(1);
        items = screen.getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("Y.md");
        expect(items[0]).toHaveTextContent("push_pin");
    });

    it("offers Unpin for pinned files and drops them back below the pins on unpin", () => {
        addRecentFile("/x.md", "X.md");
        addRecentFile("/y.md", "Y.md");
        addRecentFile("/z.md", "Z.md");
        renderScreen();
        fireEvent.contextMenu(screen.getByText("Y.md"));
        fireEvent.click(findMenuAction("Pin")!);
        fireEvent.contextMenu(screen.getByText("X.md"));
        fireEvent.click(findMenuAction("Pin")!);

        // Both pinned: Y.md (more recent) then X.md, Z.md at the bottom.
        let items = screen.getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("Y.md");
        expect(items[1]).toHaveTextContent("X.md");
        expect(items[2]).toHaveTextContent("Z.md");

        fireEvent.contextMenu(screen.getByText("Y.md"));
        expect(findMenuAction("Pin")).toBeUndefined();
        expect(findMenuAction("Unpin")).toBeTruthy();
        fireEvent.click(findMenuAction("Unpin")!);

        expect(getRecentFiles().find((f) => f.path === "/y.md")?.pinned).toBe(false);
        items = screen.getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("X.md");
        expect(items[1]).toHaveTextContent("Z.md");
        expect(items[2]).toHaveTextContent("Y.md");
        // Only X.md still shows a pin glyph.
        expect(screen.getAllByText("push_pin")).toHaveLength(1);
    });
});