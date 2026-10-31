import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { HtmlPreview } from "./HtmlPreview";

describe("HtmlPreview (#295)", () => {
    it("renders the page in a frame with no sandbox permissions", async () => {
        const { container } = render(<HtmlPreview content="<h1>Hello</h1><script>alert(1)</script>" fileName="page.html" filePath={null} />);
        await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
        const frame = container.querySelector("iframe")!;
        // Empty value = every restriction on. A permission here is a security bug.
        expect(frame.getAttribute("sandbox")).toBe("");
        const srcdoc = frame.getAttribute("srcdoc") ?? "";
        expect(srcdoc).toContain("<h1>Hello</h1>");
        expect(srcdoc).not.toContain("<script");
        expect(frame.getAttribute("title")).toBe("Rendered page.html");
    });
});
