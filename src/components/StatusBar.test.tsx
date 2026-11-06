import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";

afterEach(cleanup);

describe("StatusBar encoding (ENC-05)", () => {
  it("shows the encoding when the file isn't plain UTF-8", () => {
    render(<StatusBar isSaved lineNumber={1} columnNumber={1} encoding="UTF-16 LE" />);
    expect(screen.getByLabelText("File encoding: UTF-16 LE").textContent).toBe("UTF-16 LE");
  });

  it("stays out of the way for plain UTF-8", () => {
    render(<StatusBar isSaved lineNumber={1} columnNumber={1} encoding={null} />);
    expect(screen.queryByLabelText(/File encoding/)).toBeNull();
  });
});
