import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildHtmlDocument, type HtmlAssetReader } from "../utils/htmlDocument";
import { parentDirectory } from "../utils/documentPaths";
import { getRemoteImages } from "../utils/persistence";

interface HtmlPreviewProps {
    content: string;
    fileName: string;
    filePath: string | null;
}

const assets: HtmlAssetReader = {
    readImage: (baseDir, relPath) => invoke<ArrayBuffer>("read_image_file", { baseDir, relPath }),
    readText: async (baseDir, relPath) => {
        const sep = baseDir.includes("\\") ? "\\" : "/";
        const data = await invoke<{ content: string }>("read_file", { path: `${baseDir.replace(/[/\\]+$/, "")}${sep}${relPath}` });
        return data.content;
    },
};

/**
 * Reader view of an `.html` file: the rendered page, in a frame with no
 * permissions at all. See utils/htmlDocument.ts for why this is safe, and never
 * add `allow-scripts` together with `allow-same-origin` here: that pair lets the
 * page remove its own sandbox. The white background is what a page without one
 * assumes, whatever the app's theme. #295.
 */
export function HtmlPreview({ content, fileName, filePath }: HtmlPreviewProps) {
    const [srcDoc, setSrcDoc] = useState<string | null>(null);
    const [remoteImages, setRemoteImages] = useState(getRemoteImages);

    useEffect(() => {
        const onToggle = () => setRemoteImages(getRemoteImages());
        window.addEventListener("paperling:remote-images-toggle", onToggle);
        return () => window.removeEventListener("paperling:remote-images-toggle", onToggle);
    }, []);

    useEffect(() => {
        let cancelled = false;
        buildHtmlDocument(content, { baseDir: parentDirectory(filePath), allowRemoteImages: remoteImages, assets })
            .then((doc) => { if (!cancelled) setSrcDoc(doc); })
            .catch((err) => console.error("Failed to prepare HTML view:", err));
        return () => { cancelled = true; };
    }, [content, filePath, remoteImages]);

    return (
        <main className="flex-1 min-h-0 flex flex-col bg-white" data-html-preview>
            {srcDoc !== null && (
                <iframe
                    title={`Rendered ${fileName}`}
                    sandbox=""
                    srcDoc={srcDoc}
                    className="flex-1 w-full border-0 bg-white"
                />
            )}
        </main>
    );
}
