import { describe, expect, it } from "vitest";
import { scoreItem } from "./CommandPalette";

const rank = (query: string, labels: string[]) =>
    labels
        .map((label) => ({ label, score: scoreItem(query, [label]) }))
        .filter((item) => item.score !== -1)
        .sort((a, b) => a.score - b.score)
        .map((item) => item.label);

describe("scoreItem", () => {
    const sorts = ["Sort lines A to Z", "Sort lines Z to A"];

    it("ranks the label typed word for word first. EDIT-04", () => {
        expect(rank("Sort lines Z to A", sorts)[0]).toBe("Sort lines Z to A");
        expect(rank("sort lines z to a", sorts)[0]).toBe("Sort lines Z to A");
        expect(rank("Z to A", sorts)[0]).toBe("Sort lines Z to A");
    });

    it("keeps matching multi-word queries in any order", () => {
        expect(scoreItem("fil new", ["New file"])).not.toBe(-1);
    });

    it("does not treat a single word as a phrase, so better matches still win", () => {
        expect(rank("file", ["Profile picture", "File history"])[0]).toBe("File history");
    });

    it("returns -1 when a term matches nothing", () => {
        expect(scoreItem("zzz", ["New file"])).toBe(-1);
    });
});

describe("CommandPalette visual-order execution", () => {
    it("runs the highlighted item in grouped visual order on Enter and ignores IME composing Enter", async () => {
        const React = await import("react");
        const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
        const { CommandPalette } = await import("./CommandPalette");
        const ran: string[] = [];
        const items = [
            { id: "a", label: "open", section: "Sec A", run: () => ran.push("a") },
            { id: "b", label: "xxopen", section: "Sec B", run: () => ran.push("b") },
            { id: "c", label: "xxxopen", section: "Sec A", run: () => ran.push("c") },
        ];
        render(React.createElement(CommandPalette, { isOpen: true, items, onClose: () => {} }));
        const input = screen.getByRole("combobox");
        fireEvent.change(input, { target: { value: "open" } });
        // ranked is [a, b, c], but grouped visual order is Sec A: [a, c], Sec B: [b]
        fireEvent.keyDown(input, { key: "ArrowDown" });
        // IME Enter during composition must not execute
        fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
        expect(ran).toEqual([]);
        // Real Enter executes visual index 1 = "c" (not ranked[1] = "b")
        fireEvent.keyDown(input, { key: "Enter" });
        expect(ran).toEqual(["c"]);
        cleanup();
    });
});
