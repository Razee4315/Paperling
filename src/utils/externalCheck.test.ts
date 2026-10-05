import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeExternalChecks } from "./externalCheck";

describe("subscribeExternalChecks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks on focus and on the interval while visible, and stops on unsubscribe. EXT-07", () => {
    const check = vi.fn();
    const stop = subscribeExternalChecks(check, 1000);
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenLastCalledWith("focus");
    vi.advanceTimersByTime(1000);
    expect(check).toHaveBeenLastCalledWith("interval");
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("skips interval checks while the window is hidden", () => {
    const check = vi.fn();
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const stop = subscribeExternalChecks(check, 1000);
    vi.advanceTimersByTime(3000);
    expect(check).not.toHaveBeenCalled();
    stop();
    spy.mockRestore();
  });
});
