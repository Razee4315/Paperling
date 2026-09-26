import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TabBar } from "./TabBar";

// jsdom doesn't implement scrollIntoView; TabBar's active-tab effect calls it.
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

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
