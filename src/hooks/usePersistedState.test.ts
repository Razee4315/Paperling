import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePersistedState } from "./usePersistedState";

describe("usePersistedState", () => {
  it("initialises from the loader exactly once", () => {
    const load = vi.fn(() => "initial");
    const persist = vi.fn();
    const { result, rerender } = renderHook(() => usePersistedState(load, persist));

    expect(result.current[0]).toBe("initial");
    rerender();
    // The loader is a useState initializer — it must not run again on re-render.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("persists the loaded value on mount (idempotent write)", () => {
    const persist = vi.fn();
    renderHook(() => usePersistedState(() => "v", persist));
    expect(persist).toHaveBeenCalledWith("v");
  });

  it("persists the new value whenever state changes", () => {
    const persist = vi.fn();
    const { result } = renderHook(() => usePersistedState(() => 0, persist));

    act(() => result.current[1](1));
    expect(result.current[0]).toBe(1);
    expect(persist).toHaveBeenLastCalledWith(1);
  });

  it("supports functional updates", () => {
    const persist = vi.fn();
    const { result } = renderHook(() => usePersistedState(() => 1, persist));

    act(() => result.current[1]((n) => n + 4));
    expect(result.current[0]).toBe(5);
    expect(persist).toHaveBeenLastCalledWith(5);
  });
});
