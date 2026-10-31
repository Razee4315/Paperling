import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileHistoryDialog } from "./FileHistoryDialog";
import type { Snapshot } from "../utils/fileHistory";

const list = vi.hoisted(() => vi.fn());
vi.mock("../utils/fileHistory", () => ({ fileHistory: { list } }));

const snap = (id: number, content: string, reason: Snapshot["reason"] = "saved"): Snapshot => ({
    id, key: "k", path: "/a.md", savedAt: 1_700_000_000_000 + id, startedAt: 0, reason, content,
});

const open = (current: string, onRestore = vi.fn()) => {
    render(<FileHistoryDialog isOpen path="/a.md" fileName="a.md" current={current} onRestore={onRestore} onClose={() => {}} />);
    return onRestore;
};

afterEach(() => { cleanup(); list.mockReset(); });

describe("FileHistoryDialog (HIST-01)", () => {
    it("explains an empty history", async () => {
        list.mockResolvedValue([]);
        open("text");
        expect(await screen.findByText(/No earlier versions yet/)).toBeTruthy();
    });

    it("starts on the newest version that differs, and restores it", async () => {
        list.mockResolvedValue([snap(3, "current"), snap(2, "older"), snap(1, "oldest", "opened")]);
        const onRestore = open("current");
        await screen.findByRole("list", { name: "Versions" });
        expect(screen.getAllByRole("button", { pressed: true })[0].textContent).toContain("Saved");
        fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
        expect(onRestore).toHaveBeenCalledWith("older");
    });

    it("can pick any version", async () => {
        list.mockResolvedValue([snap(2, "older"), snap(1, "oldest", "opened")]);
        const onRestore = open("current");
        fireEvent.click(await screen.findByRole("button", { name: /Opened/ }));
        fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
        expect(onRestore).toHaveBeenCalledWith("oldest");
    });

    it("won't restore a version identical to the current text", async () => {
        list.mockResolvedValue([snap(1, "same")]);
        open("same");
        await screen.findByText("Same as your current text");
        expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(true);
    });
});
