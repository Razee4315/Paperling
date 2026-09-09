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

        // Bullet prefix on the visible label, mirroring the window title.
        expect(screen.getByText("• notes.md")).toBeInTheDocument();
        expect(screen.queryByText("• other.md")).not.toBeInTheDocument();

        // Accessible name exposes unsaved state for screen readers.
        expect(screen.getByRole("tab", { name: "notes.md (unsaved changes)" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "other.md" })).toBeInTheDocument();
    });
});
