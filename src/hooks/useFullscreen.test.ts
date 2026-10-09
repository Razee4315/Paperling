// Fullscreen on macOS belongs to the window, not to us (FULLSCREEN-02, #262):
// the green button, the View menu and a trackpad gesture all change it without
// going through the app, so the hook has to follow the window rather than
// remember what it last asked for. Elsewhere it keeps its own state, because a
// frameless window lies about being fullscreen (FULLSCREEN-01).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/** A stand-in window whose fullscreen state the test can change behind the hook's back. */
function fakeWindow() {
    const state = { full: false, maximized: false, resized: [] as Array<() => void> };
    const calls: string[] = [];
    const win = {
        isFullscreen: async () => state.full,
        isMaximized: async () => state.maximized,
        unmaximize: async () => { calls.push("unmaximize"); state.maximized = false; },
        maximize: async () => { calls.push("maximize"); state.maximized = true; },
        setFullscreen: async (next: boolean) => {
            calls.push(`setFullscreen(${next})`);
            state.full = next;
            // The OS resizes the window as it enters or leaves.
            for (const fn of state.resized) fn();
        },
        onResized: async (fn: () => void) => {
            state.resized.push(fn);
            return () => { state.resized = state.resized.filter((f) => f !== fn); };
        },
    };
    return { win, state, calls };
}

async function setup(macWindow: boolean) {
    vi.resetModules();
    const fake = fakeWindow();
    vi.doMock("@tauri-apps/api/window", () => ({ Window: { getCurrent: () => fake.win } }));
    vi.doMock("../utils/platform", async (original) => ({
        ...(await original<typeof import("../utils/platform")>()),
        MAC_WINDOW: macWindow,
    }));
    const { useFullscreen } = await import("./useFullscreen");
    const notify = vi.fn();
    const hook = renderHook(() => useFullscreen(notify));
    await act(async () => {});
    return { ...fake, notify, hook };
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.doUnmock("@tauri-apps/api/window");
    vi.doUnmock("../utils/platform");
});

describe("useFullscreen on macOS", () => {
    it("asks the window for native fullscreen, with no maximize juggling and no hint", async () => {
        const { hook, calls, notify, state } = await setup(true);
        state.maximized = true;
        await act(async () => { await hook.result.current.toggleFullscreen(); });
        expect(calls).toEqual(["setFullscreen(true)"]);
        expect(hook.result.current.isFullscreen).toBe(true);
        expect(hook.result.current.fsTransition).toBe(false);
        expect(notify).not.toHaveBeenCalled();

        await act(async () => { await hook.result.current.toggleFullscreen(); });
        expect(calls).toEqual(["setFullscreen(true)", "setFullscreen(false)"]);
        expect(hook.result.current.isFullscreen).toBe(false);
    });

    it("follows a change it did not ask for (the green button, the View menu)", async () => {
        const { hook, state, calls } = await setup(true);
        expect(hook.result.current.isFullscreen).toBe(false);
        // The user clicks the green button: the window goes fullscreen and resizes.
        state.full = true;
        await act(async () => { for (const fn of state.resized) fn(); });
        expect(hook.result.current.isFullscreen).toBe(true);
        // The next toggle therefore LEAVES fullscreen instead of asking for it again.
        await act(async () => { await hook.result.current.toggleFullscreen(); });
        expect(calls).toEqual(["setFullscreen(false)"]);
        expect(hook.result.current.isFullscreen).toBe(false);
    });

    it("starts in step with a window that is already fullscreen, and stops listening on unmount", async () => {
        vi.resetModules();
        const fake = fakeWindow();
        fake.state.full = true;
        vi.doMock("@tauri-apps/api/window", () => ({ Window: { getCurrent: () => fake.win } }));
        vi.doMock("../utils/platform", async (original) => ({
            ...(await original<typeof import("../utils/platform")>()),
            MAC_WINDOW: true,
        }));
        const { useFullscreen } = await import("./useFullscreen");
        const hook = renderHook(() => useFullscreen(vi.fn()));
        await act(async () => {});
        expect(hook.result.current.isFullscreen).toBe(true);
        expect(fake.state.resized).toHaveLength(1);
        hook.unmount();
        expect(fake.state.resized).toHaveLength(0);
    });
});

describe("useFullscreen on a frameless window (Windows, Linux)", () => {
    it("drops maximize first, shows the hint with the current shortcut, and restores maximize on exit", async () => {
        vi.useFakeTimers();
        const { hook, calls, notify, state } = await setup(false);
        state.maximized = true;
        // Nothing listens to the window: its answers are not trusted here (FULLSCREEN-01).
        expect(state.resized).toHaveLength(0);

        await act(async () => {
            const done = hook.result.current.toggleFullscreen();
            await vi.advanceTimersByTimeAsync(500);
            await done;
        });
        expect(calls).toEqual(["unmaximize", "setFullscreen(true)"]);
        expect(hook.result.current.isFullscreen).toBe(true);
        expect(notify).toHaveBeenCalledWith("Fullscreen on — press F11 to exit");

        await act(async () => {
            const done = hook.result.current.toggleFullscreen();
            await vi.advanceTimersByTimeAsync(500);
            await done;
        });
        expect(calls).toEqual(["unmaximize", "setFullscreen(true)", "setFullscreen(false)", "maximize"]);
        expect(hook.result.current.isFullscreen).toBe(false);
    });
});
