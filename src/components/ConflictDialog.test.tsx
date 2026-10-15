import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictDialog } from "./ConflictDialog";

describe("ConflictDialog", () => {
    afterEach(cleanup);

    const setup = () => {
        const handlers = {
            onKeepMine: vi.fn(),
            onLoadFromDisk: vi.fn(),
            onSaveCopy: vi.fn(),
            onClose: vi.fn(),
        };
        render(
            <ConflictDialog isOpen fileName="notes.md" {...handlers} />,
        );
        expect(screen.getByText("File changed on disk")).toBeInTheDocument();
        return handlers;
    };

    it("resolves through the save-a-copy, keep-mine and load-from-disk actions", () => {
        const h = setup();

        fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }));
        expect(h.onSaveCopy).toHaveBeenCalledTimes(1);
        expect(h.onKeepMine).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Load from disk" }));
        expect(h.onLoadFromDisk).toHaveBeenCalledTimes(1);
        expect(h.onKeepMine).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Keep my version" }));
        expect(h.onKeepMine).toHaveBeenCalledTimes(1);
    });

    it("does NOT resolve via Escape — dismissal must never arm an overwrite (EXT-02)", () => {
        const h = setup();

        fireEvent.keyDown(document, { key: "Escape" });
        // The Modal contract still fires onClose (the parent keeps the dialog
        // open on purpose), but no resolution may run.
        expect(h.onClose).toHaveBeenCalledTimes(1);
        expect(h.onKeepMine).not.toHaveBeenCalled();
        expect(h.onLoadFromDisk).not.toHaveBeenCalled();
        expect(h.onSaveCopy).not.toHaveBeenCalled();
    });
});
