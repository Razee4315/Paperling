import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../context/ThemeContext";

// The About panel resolves the version through the Tauri core API, which has no
// IPC host under jsdom — stub it so the panel behaves as it does in the app.
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "9.9.9" }));

import { SettingsModal } from "./SettingsModal";

// Vitest runs without `globals`, so React Testing Library never registers its
// own afterEach cleanup; do it here or the second render finds two dialogs.
afterEach(cleanup);

describe("Settings → About", () => {
    it("reports the running version (#148)", async () => {
        render(
            <ThemeProvider>
                <SettingsModal isOpen onClose={() => { }} />
            </ThemeProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: /about/i }));

        expect(await screen.findByText("v9.9.9")).toBeInTheDocument();
    });

    it("hides the version rather than showing a placeholder when it can't be read", async () => {
        vi.resetModules();
        vi.doMock("@tauri-apps/api/app", () => ({
            getVersion: async () => { throw new Error("no IPC host"); },
        }));
        // Re-import BOTH through the reset registry: a fresh SettingsModal paired
        // with the stale ThemeProvider would be reading a different context object.
        const { SettingsModal: Fresh } = await import("./SettingsModal");
        const { ThemeProvider: FreshProvider } = await import("../context/ThemeContext");

        render(
            <FreshProvider>
                <Fresh isOpen onClose={() => { }} />
            </FreshProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: /about/i }));

        // The panel still renders; it just carries no version chip.
        expect(await screen.findByText("A minimal markdown editor")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument());
    });
});
