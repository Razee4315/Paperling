/**
 * PREVIEW-08 (#270): outside markers need space for the widest counter in
 * THIS list, not its nested lists. Include HTML li[value] resets and signs;
 * the browser still owns the actual numbering. CSS reserves one em per
 * character so proportional digits also fit without measuring the DOM.
 */
export function orderedListMarkerCharacters(
    start: number | string | undefined,
    itemValues: readonly (number | string | undefined)[],
    reversed = false,
): number {
    // Raw HTML properties can remain strings in HAST. Parse them before
    // incrementing, just as native ol[start]/li[value] integer attributes do.
    const integer = (value: number | string | undefined): number | undefined => {
        const parsed = Number.parseInt(String(value), 10);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    let counter = integer(start) ?? (reversed ? itemValues.length : 1);
    let widest = 1;
    for (const value of itemValues) {
        counter = integer(value) ?? counter;
        widest = Math.max(widest, String(counter).length);
        counter += reversed ? -1 : 1;
    }
    return widest;
}
