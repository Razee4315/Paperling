import { describe, it, expect } from "vitest";
import {
    parseTable,
    serializeTable,
    findTableAt,
    locateCell,
    applyTableOp,
    insertColumn,
    deleteColumn,
    insertRow,
    deleteRow,
    setAlignment,
    type TableModel,
} from "./tableModel";

const SIMPLE_LINES = ["| Name | Age |", "| --- | --- |", "| Alice | 30 |", "| Bob | 25 |"];
const SIMPLE = SIMPLE_LINES.join("\n");

const FORMATTED = ["| Name  | Age |", "| ----- | --- |", "| Alice | 30  |", "| Bob   | 25  |"].join("\n");

describe("parseTable", () => {
    it("parses headers, aligns, and rows", () => {
        const m = parseTable(SIMPLE_LINES);
        expect(m.headers).toEqual(["Name", "Age"]);
        expect(m.aligns).toEqual(["none", "none"]);
        expect(m.rows).toEqual([["Alice", "30"], ["Bob", "25"]]);
    });

    it("parses alignment markers", () => {
        const m = parseTable(["| L | C | R |", "| :-- | :-: | --: |"]);
        expect(m.aligns).toEqual(["left", "center", "right"]);
    });

    it("pads ragged rows to the header column count", () => {
        const m = parseTable(["| a | b | c |", "| - | - | - |", "| 1 |", "| 1 | 2 | 3 | 4 |"]);
        expect(m.rows[0]).toEqual(["1", "", ""]);
        expect(m.rows[1]).toEqual(["1", "2", "3"]); // extra cell truncated
    });

    it("treats escaped pipes as literal cell content", () => {
        const m = parseTable(["| a | b |", "| - | - |", "| x \\| y | z |"]);
        expect(m.rows[0]).toEqual(["x \\| y", "z"]);
    });
});

describe("serializeTable", () => {
    it("pads columns to a uniform width", () => {
        expect(serializeTable(parseTable(SIMPLE_LINES))).toBe(FORMATTED);
    });

    it("emits every line at the same length", () => {
        const out = serializeTable(parseTable(SIMPLE_LINES)).split("\n");
        const len = out[0].length;
        for (const line of out) expect(line.length).toBe(len);
    });

    it("round-trips: parse(serialize(x)) preserves the model", () => {
        const m = parseTable(SIMPLE_LINES);
        const round = parseTable(serializeTable(m).split("\n"));
        expect(round).toEqual(m);
    });

    it("renders centered alignment with colon separators", () => {
        const m: TableModel = { headers: ["H"], aligns: ["center"], rows: [["x"]] };
        expect(serializeTable(m)).toBe(["|  H  |", "| :-: |", "|  x  |"].join("\n"));
    });

    it("renders left/right separators", () => {
        const m: TableModel = { headers: ["a", "b"], aligns: ["left", "right"], rows: [] };
        const sep = serializeTable(m).split("\n")[1];
        expect(sep).toBe("| :-- | --: |");
    });
});

describe("findTableAt", () => {
    const doc = "intro text\n\n" + SIMPLE + "\n\noutro";
    const tableStart = doc.indexOf("| Name");

    it("finds the table when the caret is in the header", () => {
        const r = findTableAt(doc, doc.indexOf("Name"));
        expect(r).not.toBeNull();
        expect(r!.from).toBe(tableStart);
        expect(r!.model.headers).toEqual(["Name", "Age"]);
    });

    it("finds the table from a body cell", () => {
        const r = findTableAt(doc, doc.indexOf("Bob"));
        expect(r).not.toBeNull();
        expect(r!.from).toBe(tableStart);
    });

    it("returns null outside any table", () => {
        expect(findTableAt(doc, doc.indexOf("intro"))).toBeNull();
        expect(findTableAt(doc, doc.indexOf("outro"))).toBeNull();
    });

    it("returns null for pipe rows without a separator", () => {
        const notTable = "| just | pipes |\n| more | pipes |";
        expect(findTableAt(notTable, 3)).toBeNull();
    });

    it("region.to ends at the last table line", () => {
        const r = findTableAt(doc, doc.indexOf("Alice"))!;
        expect(doc.slice(r.from, r.to)).toBe(SIMPLE);
    });
});

describe("locateCell", () => {
    const r = findTableAt(SIMPLE, 0)!;
    it("locates header cells", () => {
        expect(locateCell(r, SIMPLE.indexOf("Name"))).toEqual({ lineIndex: 0, colIndex: 0 });
        expect(locateCell(r, SIMPLE.indexOf("Age"))).toEqual({ lineIndex: 0, colIndex: 1 });
    });
    it("locates body cells", () => {
        expect(locateCell(r, SIMPLE.indexOf("Alice"))).toEqual({ lineIndex: 2, colIndex: 0 });
        expect(locateCell(r, SIMPLE.indexOf("25"))).toEqual({ lineIndex: 3, colIndex: 1 });
    });
});

describe("model operations", () => {
    const m = parseTable(SIMPLE_LINES);

    it("insertColumn adds an empty column at the index", () => {
        const out = insertColumn(m, 1);
        expect(out.headers).toEqual(["Name", "", "Age"]);
        expect(out.rows[0]).toEqual(["Alice", "", "30"]);
        expect(out.aligns).toEqual(["none", "none", "none"]);
    });

    it("deleteColumn removes a column but never the last one", () => {
        expect(deleteColumn(m, 0).headers).toEqual(["Age"]);
        const single: TableModel = { headers: ["only"], aligns: ["none"], rows: [["x"]] };
        expect(deleteColumn(single, 0)).toEqual(single); // no-op
    });

    it("insertRow inserts a blank row", () => {
        const out = insertRow(m, 1);
        expect(out.rows).toEqual([["Alice", "30"], ["", ""], ["Bob", "25"]]);
    });

    it("deleteRow removes a row; no-op on empty body", () => {
        expect(deleteRow(m, 0).rows).toEqual([["Bob", "25"]]);
        const noBody: TableModel = { headers: ["a"], aligns: ["none"], rows: [] };
        expect(deleteRow(noBody, 0)).toEqual(noBody);
    });

    it("setAlignment changes only the target column", () => {
        expect(setAlignment(m, 1, "right").aligns).toEqual(["none", "right"]);
    });
});

describe("applyTableOp", () => {
    const doc = "# Title\n\n" + SIMPLE + "\n\nend";
    const at = (needle: string) => doc.indexOf(needle);
    const state = (pos: number) => ({ text: doc, selStart: pos, selEnd: pos });

    it("returns null when the caret is not in a table", () => {
        expect(applyTableOp(state(at("Title")), { kind: "format" })).toBeNull();
    });

    it("format re-pads a drifted table in place", () => {
        const drifted = "x\n\n|a|b|\n|-|-|\n|longvalue|y|\n\nz";
        const r = applyTableOp({ text: drifted, selStart: drifted.indexOf("a|") , selEnd: drifted.indexOf("a|") }, { kind: "format" })!;
        expect(r).not.toBeNull();
        const lines = r.text.split("\n").filter((l) => l.startsWith("|"));
        const len = lines[0].length;
        for (const l of lines) expect(l.length).toBe(len); // uniform => drift fixed
    });

    it("col-right inserts a column after the caret column and lands the caret in it", () => {
        const r = applyTableOp(state(at("Alice")), { kind: "col-right" })!;
        const reg = findTableAt(r.text, r.selStart)!;
        expect(reg.model.headers.length).toBe(3);
        expect(locateCell(reg, r.selStart).colIndex).toBe(1);
    });

    it("col-left inserts a column at the caret column", () => {
        const r = applyTableOp(state(at("Age")), { kind: "col-left" })!;
        const reg = findTableAt(r.text, r.selStart)!;
        expect(reg.model.headers.length).toBe(3);
    });

    it("row-below adds a blank row under the caret row", () => {
        const r = applyTableOp(state(at("Alice")), { kind: "row-below" })!;
        const reg = findTableAt(r.text, r.selStart)!;
        expect(reg.model.rows.length).toBe(3);
        const cell = locateCell(reg, r.selStart);
        expect(cell.lineIndex).toBe(3); // the new row (header=0, sep=1, Alice=2, new=3)
        expect(reg.model.rows[1]).toEqual(["", ""]);
    });

    it("row-delete removes the caret's body row", () => {
        const r = applyTableOp(state(at("Alice")), { kind: "row-delete" })!;
        const reg = findTableAt(r.text, r.selStart)!;
        expect(reg.model.rows).toEqual([["Bob", "25"]]);
    });

    it("row-delete is a no-op (null) on the header row", () => {
        expect(applyTableOp(state(at("Name")), { kind: "row-delete" })).toBeNull();
    });

    it("col-delete removes the caret column", () => {
        const r = applyTableOp(state(at("Alice")), { kind: "col-delete" })!;
        const reg = findTableAt(r.text, r.selStart)!;
        expect(reg.model.headers).toEqual(["Age"]);
    });

    it("align sets the caret column's alignment", () => {
        const r = applyTableOp(state(at("Name")), { kind: "align", align: "center" })!;
        const reg = findTableAt(r.text, r.selStart)!;
        expect(reg.model.aligns[0]).toBe("center");
    });

    it("preserves text outside the table", () => {
        const r = applyTableOp(state(at("Alice")), { kind: "format" })!;
        expect(r.text.startsWith("# Title\n\n")).toBe(true);
        expect(r.text.endsWith("\n\nend")).toBe(true);
    });
});
