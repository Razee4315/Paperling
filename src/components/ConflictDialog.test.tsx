import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConflictDialog } from "./ConflictDialog";

describe("ConflictDialog", () => {
    it("resolves through keep-mine and load-from-disk actions", () => {
        const onKeepMine = vi.fn();
        const onLoadFromDisk = vi.fn();
        const onClose = vi.fn();

        render(
            <ConflictDialog
                isOpen
                fileName="notes.md"
                onKeepMine={onKeepMine}
                onLoadFromDisk={onLoadFromDisk}
                onClose={onClose}
            />,
        );

        expect(screen.getByText("File changed on disk")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Load from disk" }));
        expect(onLoadFromDisk).toHaveBeenCalledTimes(1);
        expect(onKeepMine).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Keep my version" }));
        expect(onKeepMine).toHaveBeenCalledTimes(1);
    });

    it("treats dismissal (Escape) as keeping my version", () => {
        const onKeepMine = vi.fn();
        const onLoadFromDisk = vi.fn();
        const onClose = vi.fn();

        render(
            <ConflictDialog
                isOpen
                fileName="notes.md"
                onKeepMine={onKeepMine}
                onLoadFromDisk={onLoadFromDisk}
                onClose={onClose}
            />,
        );

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onLoadFromDisk).not.toHaveBeenCalled();
    });
});
