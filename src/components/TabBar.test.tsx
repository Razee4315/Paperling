import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TabBar, tabIndexAtX, tabShiftFor } from "./TabBar";

// jsdom doesn't implement scrollIntoView; TabBar's active-tab effect calls it.
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});
// Vitest globals are off, so testing-library doesn't auto-unmount between tests.
afterEach(cleanup);

function renderTabs(dirtyStates: { name: string; dirty: boolean }[]) {
    return render(
        <TabBar
            tabs={dirtyStates.map((t, i) => ({
                id: `tab-${i}`,
                name: t.name,
                label: t.name,
                dirty: t.dirty,
            }))}
            activeId="tab-0"
            onSelect={vi.fn()}
            onClose={vi.fn()}
            onNewTab={vi.fn()}
        />,
    );
}

describe("TabBar unsaved indicator", () => {
    it("marks dirty tabs with a bullet next to the name and in the accessible name", () => {
        renderTabs([
            { name: "notes.md", dirty: true },
            { name: "other.md", dirty: false },
        ]);

        // Bullet before the label, mirroring the window title. It lives in a
        // fixed slot that clean tabs keep too (invisible), so a tab never
        // changes width when it becomes dirty or is saved. TABS-23.
        const bullet = (name: string) =>
            screen.getByRole("tab", { name: new RegExp(`^${name.replace(".", "\\.")}`) }).querySelector("span[aria-hidden='true'].w-1\\.5")!;
        expect(bullet("notes.md").textContent).toBe("•");
        expect(bullet("notes.md").className).not.toContain("invisible");
        expect(bullet("other.md").className).toContain("invisible");
        expect(screen.getByText("notes.md")).toBeInTheDocument();

        // Accessible name exposes unsaved state for screen readers.
        expect(screen.getByRole("tab", { name: "notes.md (unsaved changes)" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "other.md" })).toBeInTheDocument();
    });
});

describe("tabIndexAtX", () => {
    const rects = [{ left: 0, right: 100 }, { left: 100, right: 200 }, { left: 200, right: 300 }];
    it("finds the tab under the pointer and clamps past either end. TABS-24", () => {
        expect(tabIndexAtX(rects, -20)).toBe(0);
        expect(tabIndexAtX(rects, 50)).toBe(0);
        expect(tabIndexAtX(rects, 150)).toBe(1);
        expect(tabIndexAtX(rects, 299)).toBe(2);
        expect(tabIndexAtX(rects, 900)).toBe(2);
        expect(tabIndexAtX([], 10)).toBe(-1);
    });
});

describe("tabShiftFor", () => {
    it("slides the tabs between origin and slot toward the origin. TABS-24", () => {
        // Dragging tab 0 right to slot 2: tabs 1 and 2 move left one width.
        expect([0, 1, 2, 3].map((i) => tabShiftFor(i, 0, 2, 100))).toEqual([0, -100, -100, 0]);
        // Dragging tab 3 left to slot 1: tabs 1 and 2 move right.
        expect([0, 1, 2, 3].map((i) => tabShiftFor(i, 3, 1, 100))).toEqual([0, 100, 100, 0]);
        // Not moved yet: nothing shifts.
        expect([0, 1, 2].map((i) => tabShiftFor(i, 1, 1, 100))).toEqual([0, 0, 0]);
    });
});

describe("TabBar mouse drag reorder", () => {
    // Pointer events instead of HTML5 drag-and-drop, which Tauri's file-drop
    // handler swallows in the macOS webview. TABS-24.
    function renderDraggable() {
        const onReorder = vi.fn();
        const onSelect = vi.fn();
        render(
            <TabBar
                tabs={["a.md", "b.md", "c.md"].map((name, i) => ({ id: `t${i}`, name, label: name, dirty: false }))}
                activeId="t0"
                onSelect={onSelect}
                onClose={vi.fn()}
                onNewTab={vi.fn()}
                onReorder={onReorder}
            />,
        );
        const tabs = screen.getAllByRole("tab");
        tabs.forEach((el, i) => {
            el.getBoundingClientRect = () => ({ left: i * 100, right: (i + 1) * 100, top: 0, bottom: 36, width: 100, height: 36, x: i * 100, y: 0, toJSON: () => ({}) });
            el.setPointerCapture = vi.fn();
        });
        return { tabs, onReorder, onSelect };
    }
    const ptr = (clientX: number) => ({ pointerId: 1, pointerType: "mouse", button: 0, clientX });

    it("moves the dragged tab to the tab it is released over", () => {
        const { tabs, onReorder, onSelect } = renderDraggable();
        fireEvent.pointerDown(tabs[0], ptr(50));
        fireEvent.pointerMove(tabs[0], ptr(120));
        fireEvent.pointerMove(tabs[0], ptr(250));
        // The tab follows the pointer while the one it passed slides aside.
        expect(tabs[0].style.transform).toBe("translateX(200px)");
        expect(tabs[1].style.transform).toBe("translateX(-100px)");
        fireEvent.pointerUp(tabs[0], ptr(250));
        fireEvent.click(tabs[0]);
        expect(tabs[0].style.transform).toBe("");
        expect(onReorder).toHaveBeenCalledWith(0, 2);
        // The release isn't also a click on the tab.
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("treats a press without real movement as a click", () => {
        const { tabs, onReorder, onSelect } = renderDraggable();
        fireEvent.pointerDown(tabs[1], ptr(150));
        fireEvent.pointerMove(tabs[1], ptr(152));
        fireEvent.pointerUp(tabs[1], ptr(152));
        fireEvent.click(tabs[1]);
        expect(onReorder).not.toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalledWith("t1");
    });

    it("does not reorder when the drag is cancelled", () => {
        const { tabs, onReorder } = renderDraggable();
        fireEvent.pointerDown(tabs[0], ptr(50));
        fireEvent.pointerMove(tabs[0], ptr(250));
        fireEvent.pointerCancel(tabs[0], ptr(250));
        expect(onReorder).not.toHaveBeenCalled();
    });
});
