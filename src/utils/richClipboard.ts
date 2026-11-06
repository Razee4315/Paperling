/**
 * Copy the whole rendered document for pasting into Word, Gmail, Google Docs or
 * a CMS. COPY-02. Selecting everything in the Reader only copied what was
 * rendered at the time, and only in Reader mode.
 *
 * Both flavours go on the clipboard: rich apps take the HTML, plain-text fields
 * get the Markdown source.
 */
export async function writeRichClipboard(html: string, text: string): Promise<void> {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/html": new Blob([html], { type: "text/html" }),
                    "text/plain": new Blob([text], { type: "text/plain" }),
                }),
            ]);
            return;
        } catch {
            // Some webviews refuse rich writes: fall through to the copy event.
        }
    }
    const onCopy = (event: ClipboardEvent) => {
        event.clipboardData?.setData("text/html", html);
        event.clipboardData?.setData("text/plain", text);
        event.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    try {
        if (!document.execCommand("copy")) throw new Error("Copying isn't available here");
    } finally {
        document.removeEventListener("copy", onCopy);
    }
}
