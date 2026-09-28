import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel } from "./BacklinksPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("BacklinksPanel", () => {
    beforeEach(() => vi.mocked(invoke).mockReset());

    it("loads backlinks for the active file and opens the selected match", async () => {
        vi.mocked(invoke).mockResolvedValue([
            { path: "C:/notes/source.md", name: "source.md", matches: [{ line: 4, text: "See [[target]]" }] },
        ]);
        const onFileSelect = vi.fn();

        render(
            <BacklinksPanel
                isOpen
                directory="C:/notes"
                currentFilePath="C:/notes/target.md"
                onFileSelect={onFileSelect}
                onClose={vi.fn()}
            />,
        );

        await waitFor(() =>
            expect(invoke).toHaveBeenCalledWith("find_backlinks", {
                directory: "C:/notes",
                targetFile: "C:/notes/target.md",
            }),
        );
        fireEvent.click(await screen.findByRole("button", { name: "Open source.md at line 4" }));
        expect(onFileSelect).toHaveBeenCalledWith("C:/notes/source.md", 4);
    });

    it("shows an empty state when no note links to the file", async () => {
        vi.mocked(invoke).mockResolvedValue([]);

        render(
            <BacklinksPanel
                isOpen
                directory="C:/notes"
                currentFilePath="C:/notes/target.md"
                onFileSelect={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByText("No notes link here yet.")).toBeInTheDocument();
    });
});
