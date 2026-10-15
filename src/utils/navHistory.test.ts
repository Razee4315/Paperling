import { describe, it, expect } from "vitest";
import { emptyNavHistory, navigateBack, navigateForward, recordNavigation } from "./navHistory";

const A = { path: "C:/a.md", line: 10 };
const B = { path: "C:/b.md", line: 1 };
const C = { path: "C:/c.md", line: 5 };

describe("navigation history (NAV-13)", () => {
    it("goes back and forward like a browser", () => {
        let h = recordNavigation(emptyNavHistory(), A); // A -> B
        h = recordNavigation(h, B); // B -> C
        const back1 = navigateBack(h, C)!;
        expect(back1.target).toEqual(B);
        const back2 = navigateBack(back1.history, B)!;
        expect(back2.target).toEqual(A);
        expect(navigateBack(back2.history, A)).toBeNull();
        const fwd = navigateForward(back2.history, A)!;
        expect(fwd.target).toEqual(B);
        expect(navigateForward(fwd.history, B)!.target).toEqual(C);
    });

    it("a new jump clears forward history and ignores duplicate entries", () => {
        let h = recordNavigation(emptyNavHistory(), A);
        h = navigateBack(h, B)!.history;
        expect(h.forward).toEqual([B]);
        h = recordNavigation(h, A);
        h = recordNavigation(h, A);
        expect(h.forward).toEqual([]);
        expect(h.back).toEqual([A]);
    });
});
