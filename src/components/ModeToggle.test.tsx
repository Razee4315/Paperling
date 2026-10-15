import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModeToggle } from "./ModeToggle";

afterEach(cleanup);

describe("mode selection (#232)", () => {
    it("exposes the active mode and changes mode on click", () => {
        const onSetMode = vi.fn();
        const { rerender } = render(<ModeToggle mode="code" onSetMode={onSetMode} />);
        expect(screen.getByRole("button", { name: "Code editor" })).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(screen.getByRole("button", { name: "Reader mode" }));
        expect(onSetMode).toHaveBeenCalledWith("preview");
        rerender(<ModeToggle mode="preview" onSetMode={onSetMode} />);
        expect(screen.getByRole("button", { name: "Reader mode" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Code editor" })).toHaveAttribute("aria-pressed", "false");
    });
});
