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

it("expands and collapses folders inline without navigating away", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args) =>
        cmd === "list_directory_files" ? listings[(args as { directory: string }).directory] ?? [] : null,
    );
    render(<FileExplorer isOpen currentFilePath="C:/notes/a.md" onClose={vi.fn()} onFileSelect={vi.fn()} />);
    const expandBtn = await screen.findByRole("button", { name: "Expand sub" });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expandBtn);
    expect(await screen.findByRole("option", { name: /b.md/ })).toBeDefined();
    expect(screen.getByRole("option", { name: /a.md/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "Collapse sub" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sub" }));
    expect(screen.queryByRole("option", { name: /b.md/ })).toBeNull();
});

it("offers Duplicate, Copy path, and Reveal in folder and duplicates files cleanly", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
        if (cmd === "list_directory_files") return listings[(args as { directory: string }).directory] ?? [];
        if (cmd === "read_file") return { content: "# Hello copy", encoding: "utf-8" };
        if (cmd === "get_file_info") throw new Error("not found");
        if (cmd === "save_file") return 1234;
        return null;
    });
    const onNotify = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<FileExplorer isOpen currentFilePath="C:/notes/a.md" onClose={onClose} onFileSelect={vi.fn()} onNotify={onNotify} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for a.md" }));
    const menu = screen.getByRole("menu");
    // Rendered via portal onto document.body so sidebar transform + overflow-hidden cannot clip it.
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Reveal in folder" })).toBeDefined();
    // Escape dismisses the menu without closing the explorer panel.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "More actions for a.md" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() =>
        expect(vi.mocked(invoke)).toHaveBeenCalledWith(
            "save_file",
            expect.objectContaining({ path: "C:/notes/a (copy).md", content: "# Hello copy" }),
        ),
    );
    expect(onNotify).toHaveBeenCalledWith('Created "a (copy).md"', "success");
});
