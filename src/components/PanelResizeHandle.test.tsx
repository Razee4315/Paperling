import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { PanelResizeHandle } from "./PanelResizeHandle";

const MIN = 280;
const MAX = 900;

// jsdom windows are 1024 wide by default; the panel is right-anchored, so its
// width is (window width - pointer x).
const setup = (width = 400) => {
    const onResize = vi.fn();
    const onCommit = vi.fn();
    render(
        <PanelResizeHandle
            width={width}
            min={MIN}
            max={MAX}
            onResize={onResize}
            onCommit={onCommit}
            label="Resize AI panel"
        />
    );
    return { onResize, onCommit, handle: screen.getByRole("separator", { name: "Resize AI panel" }) };
};

/** jsdom does not implement pointer capture. */
const withCapture = (el: HTMLElement) => {
    (el as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    (el as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
};

const drag = (handle: HTMLElement, toClientX: number) => {
    withCapture(handle);
    act(() => {
        fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: toClientX });
    });
};

afterEach(() => {
    cleanup();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
});

describe("PanelResizeHandle", () => {
    it("exposes its range to assistive tech", () => {
        const { handle } = setup(512);
        expect(handle).toHaveAttribute("aria-orientation", "vertical");
        expect(handle).toHaveAttribute("aria-valuenow", "512");
        expect(handle).toHaveAttribute("aria-valuemin", String(MIN));
        expect(handle).toHaveAttribute("aria-valuemax", String(MAX));
    });

    it("reports width as the distance from the right edge while dragging", () => {
        const { onResize, handle } = setup();
        drag(handle, window.innerWidth - 500);
        expect(onResize).toHaveBeenLastCalledWith(500);
    });

    it("ignores pointer movement before a drag starts", () => {
        const { onResize, handle } = setup();
        act(() => { fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 }); });
        expect(onResize).not.toHaveBeenCalled();
    });

    it("clamps to the minimum when dragged past it", () => {
        const { onResize, handle } = setup();
        // Far right, i.e. a panel narrower than allowed.
        drag(handle, window.innerWidth - 10);
        expect(onResize).toHaveBeenLastCalledWith(MIN);
    });

    it("clamps to the maximum when dragged past it", () => {
        const { onResize, handle } = setup();
        drag(handle, -5000);
        expect(onResize).toHaveBeenLastCalledWith(MAX);
    });

    it("commits once on release, not on every move", () => {
        const { onResize, onCommit, handle } = setup();
        withCapture(handle);
        act(() => {
            fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
            fireEvent.pointerMove(handle, { pointerId: 1, clientX: window.innerWidth - 500 });
            fireEvent.pointerMove(handle, { pointerId: 1, clientX: window.innerWidth - 600 });
        });
        expect(onResize).toHaveBeenCalledTimes(2);
        expect(onCommit).not.toHaveBeenCalled();

        act(() => { fireEvent.pointerUp(handle, { pointerId: 1 }); });
        expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("commits on a cancelled pointer too, so a lost drag still persists", () => {
        const { onCommit, handle } = setup();
        drag(handle, window.innerWidth - 500);
        act(() => { fireEvent.pointerCancel(handle, { pointerId: 1 }); });
        expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("does not commit on a stray pointerup with no drag in progress", () => {
        const { onCommit, handle } = setup();
        withCapture(handle);
        act(() => { fireEvent.pointerUp(handle, { pointerId: 1 }); });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("grows the panel with ArrowLeft and shrinks it with ArrowRight", () => {
        // The handle is on the panel's left edge, so left means wider.
        const { onResize, onCommit, handle } = setup(400);

        act(() => { fireEvent.keyDown(handle, { key: "ArrowLeft" }); });
        expect(onResize).toHaveBeenLastCalledWith(416);
        expect(onCommit).toHaveBeenLastCalledWith(416);

        act(() => { fireEvent.keyDown(handle, { key: "ArrowRight" }); });
        expect(onResize).toHaveBeenLastCalledWith(384);
    });

    it("clamps keyboard nudges at the bounds", () => {
        const atMin = setup(MIN);
        act(() => { fireEvent.keyDown(atMin.handle, { key: "ArrowRight" }); });
        expect(atMin.onResize).toHaveBeenLastCalledWith(MIN);
        cleanup();

        const atMax = setup(MAX);
        act(() => { fireEvent.keyDown(atMax.handle, { key: "ArrowLeft" }); });
        expect(atMax.onResize).toHaveBeenLastCalledWith(MAX);
    });

    it("ignores other keys", () => {
        const { onResize, handle } = setup();
        act(() => { fireEvent.keyDown(handle, { key: "Enter" }); });
        act(() => { fireEvent.keyDown(handle, { key: "ArrowUp" }); });
        expect(onResize).not.toHaveBeenCalled();
    });

    it("restores the document cursor when unmounted mid-drag", () => {
        const { handle } = setup();
        drag(handle, window.innerWidth - 500);
        expect(document.body.style.cursor).toBe("col-resize");

        cleanup();
        expect(document.body.style.cursor).toBe("");
        expect(document.body.style.userSelect).toBe("");
    });
});
