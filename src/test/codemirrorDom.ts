// CodeMirror measures text with Range.getClientRects, which jsdom doesn't
// implement. Empty rects are enough for CM to mount and route events.
// Call from a beforeAll in any test that mounts the editor.
export function installCodeMirrorDomPolyfills() {
    const rect = {
        x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
        toJSON() { return this; },
    };
    Range.prototype.getClientRects = () =>
        Object.assign([], { item: () => null }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect as DOMRect;
}
