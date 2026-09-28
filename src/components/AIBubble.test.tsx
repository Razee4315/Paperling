import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AIBubble } from "./AIBubble";

const cfg = { endpoint: "https://x/v1/chat/completions", model: "m", apiKey: "k" };
const noop = () => {};

describe("AIBubble", () => {
    it("renders nothing without an anchor", () => {
        const { container } = render(
            <AIBubble anchor={null} selectedText="x" config={cfg} onReplace={noop} onInsert={noop} onClose={noop} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("shows no action buttons when nothing is selected", () => {
        render(
            <AIBubble anchor={{ x: 0, y: 0 }} selectedText="" config={cfg} onReplace={noop} onInsert={noop} onClose={noop} />
        );
        expect(screen.queryByText("Continue")).toBeNull();
        expect(screen.queryByText("Rewrite")).toBeNull();
    });

    it("shows selection actions when text is selected", () => {
        render(
            <AIBubble anchor={{ x: 0, y: 0 }} selectedText="hello" config={cfg} onReplace={noop} onInsert={noop} onClose={noop} />
        );
        expect(screen.getByText("Rewrite")).toBeInTheDocument();
        expect(screen.getByText("Shorten")).toBeInTheDocument();
        expect(screen.getByText("Expand")).toBeInTheDocument();
    });
});
