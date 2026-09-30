import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSidePanel } from "./useSidePanel";

vi.mock("../utils/platform", () => ({ IS_MOBILE: false }));
afterEach(cleanup);

function Host({ open, close }: { open: boolean; close: () => void }) {
    const panel = useRef<HTMLDivElement>(null);
    useSidePanel(panel, open, close);
    return <><input aria-label="Editor" /><div ref={panel} tabIndex={-1} data-testid="panel"><button>Panel action</button></div></>;
}

describe("non-modal panel focus (PANEL-02)", () => {
    it("keeps editor focus across callback changes and uses the latest close handler", () => {
        const first = vi.fn(), next = vi.fn();
        const { rerender } = render(<Host open close={first} />);
        const editor = screen.getByLabelText("Editor");
        editor.focus();
        fireEvent.input(editor, { target: { value: "Typing with Files open" } });
        rerender(<Host open close={next} />);
        expect(document.activeElement).toBe(editor);
        fireEvent.keyDown(editor, { key: "Escape" });
        expect(next).not.toHaveBeenCalled();
        screen.getByTestId("panel").focus();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(next).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
    });
    it("remembers the opener before moving focus into the panel", () => {
        const close = vi.fn();
        const { rerender } = render(<Host open={false} close={close} />);
        const editor = screen.getByLabelText("Editor");
        editor.focus();
        rerender(<Host open close={close} />);
        expect(document.activeElement).toBe(screen.getByTestId("panel"));
        rerender(<Host open={false} close={close} />);
        expect(document.activeElement).toBe(editor);
    });
});
