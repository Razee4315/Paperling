import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCustomCss } from "./useCustomCss";
import { getCustomCss, setCustomCss } from "../utils/persistence";

const styleEl = () => document.getElementById("paperling-custom-css");

afterEach(() => {
    cleanup();
    setCustomCss("");
    styleEl()?.remove();
});

describe("useCustomCss (THEME-05)", () => {
    it("applies saved CSS on start", () => {
        setCustomCss("h1 { color: red }");
        renderHook(() => useCustomCss());
        expect(styleEl()?.textContent).toBe("h1 { color: red }");
    });

    it("follows edits and removes the element when cleared", () => {
        renderHook(() => useCustomCss());
        expect(styleEl()).toBeNull();
        act(() => { setCustomCss("p { margin: 0 }"); window.dispatchEvent(new CustomEvent("paperling:custom-css-change")); });
        expect(styleEl()?.textContent).toBe("p { margin: 0 }");
        act(() => { setCustomCss("  "); window.dispatchEvent(new CustomEvent("paperling:custom-css-change")); });
        expect(styleEl()).toBeNull();
    });

    it("caps what it stores", () => {
        setCustomCss("x".repeat(300_000));
        expect(getCustomCss().length).toBeLessThanOrEqual(100_000);
    });
});
