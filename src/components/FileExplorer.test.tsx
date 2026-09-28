import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { FileExplorer } from "./FileExplorer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(cleanup);

const listings: Record<string, { name: string; path: string; is_dir: boolean }[]> = {
    "C:/notes": [
        { name: "sub", path: "C:/notes/sub", is_dir: true },
        { name: "a.md", path: "C:/notes/a.md", is_dir: false },
    ],
    "C:/notes/sub": [{ name: "b.md", path: "C:/notes/sub/b.md", is_dir: false }],
};

// FILES-02: with the explorer open, switching to a note in another folder
// must move the list there. It used to keep showing the folder it was opened
// with until the panel was closed and reopened.
describe("FileExplorer follows the active note (FILES-02)", () => {
    it("re-lists the active note's folder and highlights it on a tab switch", async () => {
        (invoke as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string, args: { directory: string }) =>
            cmd === "list_directory_files" ? listings[args.directory] ?? [] : null,
        );
        const props = { isOpen: true, onFileSelect: () => {}, onClose: () => {} };
        const { container, rerender } = render(<FileExplorer {...props} currentFilePath="C:/notes/a.md" />);
        await waitFor(() => expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("a.md"));

        rerender(<FileExplorer {...props} currentFilePath="C:/notes/sub/b.md" />);
        await waitFor(() => expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("b.md"));
        expect(container.textContent).not.toContain("a.md");
    });
});
