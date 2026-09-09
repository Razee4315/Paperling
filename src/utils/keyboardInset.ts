/**
 * On-screen keyboard inset, computed the only way that doesn't lie:
 * the DIFFERENCE between the layout viewport (`100dvh`'s height) and the
 * visual viewport, applied as padding — never as a height.
 *
 * Why: with `viewport-fit=cover`, Android's IME is a pure overlay that never
 * resizes the layout viewport, so `100dvh` alone keeps fields behind the
 * keyboard. But some Android WebViews DO shrink the layout viewport — and on
 * those, setting the shell height from `visualViewport.height` subtracts the
 * keyboard a SECOND time (dead band, content stuck high, header scrolled
 * away). Measuring `layout - (visual + offsetTop)` and applying it as
 * padding is invariant to which behavior the device chose: when both
 * viewports agree the inset is 0 and nothing changes.
 *
 * `offsetTop` matters on iOS, which pans rather than resizes; ignoring it
 * would report a phantom inset there.
 */

export interface KeyboardInsetFrame {
    /** `document.documentElement.clientHeight` — what `100dvh` resolves to. */
    layoutHeight: number;
    /** `visualViewport.height`; `undefined` where the API is missing. */
    visualHeight: number | undefined;
    /** `visualViewport.offsetTop` — iOS pans instead of resizing. */
    offsetTop: number;
    /** `visualViewport.scale` — pinch-zoom must never be read as a keyboard. */
    scale?: number;
}

/**
 * The covered height in whole pixels, or 0 when the keyboard is closed (or
 * the covered region is a pinch-zoom artifact). The result is always >= 0:
 * mid-rotation frames can momentarily yield a negative delta, which would
 * otherwise become a nonsense negative padding.
 */
export function keyboardInset(f: KeyboardInsetFrame): number {
    if (f.visualHeight === undefined) return 0;
    // A scale above 1 means the user is zoomed into content — the visual
    // viewport shrank because of the pinch, not a keyboard. Reacting would
    // wedge a keyboard-sized gap under the app while zoomed in.
    if (f.scale !== undefined && f.scale > 1.01) return 0;
    const covered = f.layoutHeight - (f.visualHeight + f.offsetTop);
    return covered > 1 ? Math.round(covered) : 0;
}
