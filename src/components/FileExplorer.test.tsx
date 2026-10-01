import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { FileExplorer } from "./FileExplorer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const platform = vi.hoisted(() => ({ IS_MOBILE: false }));
vi.mock("../utils/platform", () => platform);

afterEach(() => { cleanup(); platform.IS_MOBILE = false; });

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

describe("opening from the Files panel (#225)", () => {
    it.each([false, true])("closes only the mobile sheet (mobile=%s)", async (mobile) => {
        platform.IS_MOBILE = mobile;
        vi.mocked(invoke).mockResolvedValue(listings["C:/notes"]);
        const onClose = vi.fn();
        const onFileSelect = vi.fn();
        render(<FileExplorer isOpen currentFilePath="C:/notes/a.md" onClose={onClose} onFileSelect={onFileSelect} />);
        fireEvent.click(await screen.findByRole("option", { name: /a.md/ }));
        expect(onFileSelect).toHaveBeenCalledWith("C:/notes/a.md");
        expect(onClose).toHaveBeenCalledTimes(mobile ? 1 : 0);
    });
});

it("keeps an explicit folder rooted when the active tab changes elsewhere (#227)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args) => cmd === "list_directory_files" ? listings[(args as { directory: string }).directory] ?? [] : null);
    const props = { isOpen: true, rootDirectory: "C:/notes", onClose: vi.fn(), onFileSelect: vi.fn() };
    const { rerender } = render(<FileExplorer {...props} currentFilePath="C:/elsewhere/a.md" />);
    expect(await screen.findByRole("option", { name: /a.md/ })).toBeDefined();
    fireEvent.click(screen.getByRole("option", { name: /sub/ }));
    expect(await screen.findByRole("option", { name: /b.md/ })).toBeDefined();
    rerender(<FileExplorer {...props} currentFilePath="C:/elsewhere/b.md" />);
    expect(screen.getByRole("option", { name: /b.md/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Go up/ }));
    await screen.findByRole("option", { name: /a.md/ });
    expect(screen.getByRole("button", { name: /Go up/ }).hasAttribute("disabled")).toBe(true);
});
