/**
 * Back / forward history for link navigation. NAV-13.
 *
 * Following a [[wikilink]], a relative link, a #heading link or a search
 * result jumps to another place; there was no way back except finding the
 * old tab by hand. Obsidian and every browser keep a back stack. Entries are
 * "file + line"; the model is pure so it can be tested and kept in a ref.
 */

export interface NavEntry {
    path: string;
    line: number;
}

export interface NavHistory {
    back: NavEntry[];
    forward: NavEntry[];
}

const MAX = 50;

export const emptyNavHistory = (): NavHistory => ({ back: [], forward: [] });

const same = (a: NavEntry | undefined, b: NavEntry) => !!a && a.path === b.path && a.line === b.line;

/** Record `from` before a link is followed. A new jump clears "forward". */
export function recordNavigation(h: NavHistory, from: NavEntry): NavHistory {
    const back = same(h.back[h.back.length - 1], from) ? h.back : [...h.back, from].slice(-MAX);
    return { back, forward: [] };
}

/** Step back from `current`; null when there is nothing to go back to. */
export function navigateBack(h: NavHistory, current: NavEntry | null): { history: NavHistory; target: NavEntry } | null {
    const target = h.back[h.back.length - 1];
    if (!target) return null;
    return {
        target,
        history: { back: h.back.slice(0, -1), forward: current ? [...h.forward, current].slice(-MAX) : h.forward },
    };
}

/** Step forward from `current`; null when there is nothing ahead. */
export function navigateForward(h: NavHistory, current: NavEntry | null): { history: NavHistory; target: NavEntry } | null {
    const target = h.forward[h.forward.length - 1];
    if (!target) return null;
    return {
        target,
        history: { back: current ? [...h.back, current].slice(-MAX) : h.back, forward: h.forward.slice(0, -1) },
    };
}
