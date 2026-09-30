import { pathKey } from "./tabsModel";

/** Shared native and browser drop filter, including plain-text notes. */
export const isDocumentPath = (path: string): boolean => /\.(md|markdown|txt|text)$/i.test(path);

export const isPathWithin = (path: string, root: string): boolean => {
    const clean = (p: string) => pathKey(p).replace(/\/+$/, "");
    return clean(path) === clean(root) || clean(path).startsWith(clean(root) + "/");
};
