import { useEffect } from "react";
import { getCustomCss } from "../utils/persistence";

const STYLE_ID = "paperling-custom-css";

/** Last in <head>, so it wins over the app's own styles of equal specificity. */
function applyCustomCss(css: string) {
    const existing = document.getElementById(STYLE_ID);
    if (!css.trim()) {
        existing?.remove();
        return;
    }
    const style = existing ?? document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    if (!existing) document.head.appendChild(style);
}

/** Settings → Appearance → Custom CSS, the user's own styles. THEME-05. */
export function useCustomCss() {
    useEffect(() => {
        const apply = () => applyCustomCss(getCustomCss());
        apply();
        window.addEventListener("paperling:custom-css-change", apply);
        return () => window.removeEventListener("paperling:custom-css-change", apply);
    }, []);
}
