/**
 * Local font-family discovery for the custom-font inputs (SET-03).
 *
 * Two strategies, tried in order:
 *  1. Local Font Access API (`queryLocalFonts`) — exact, near-instant. Needs
 *     a user gesture + permission; unavailable on Android/WebKitGTK, and the
 *     prompt can be denied anywhere.
 *  2. Width-probe fallback — the classic measurement technique: a font family
 *     is installed when a test string rendered in `"Family", <base>` measures
 *     differently from `<base>` alone. Permission-free, works everywhere the
 *     app runs.
 *
 * Efficiency contract (owner request): NOTHING runs at app startup. The list
 * is computed lazily on the first focus/typing in a font input, cached in a
 * module promise (one probe pass per session, ~50ms), and handed to a native
 * `<datalist>` — so filtering as the user types is the browser's job, not JS.
 */

/** Common families across Windows / macOS / Linux / Android, plus fonts the
 *  bundled markdown previews realistically encounter. Probing an absent name
 *  costs one width comparison, so generosity here is cheap. */
const CANDIDATE_FAMILIES = [
    // Windows core
    "Arial", "Arial Black", "Bahnschrift", "Calibri", "Cambria", "Candara",
    "Comic Sans MS", "Consolas", "Constantia", "Corbel", "Courier New",
    "Ebrima", "Franklin Gothic Medium", "Gabriola", "Gadugi", "Georgia",
    "Impact", "Ink Free", "Javanese Text", "Leelawadee UI", "Lucida Console",
    "Lucida Sans Unicode", "Malgun Gothic", "Marlett", "Microsoft Himalaya",
    "Microsoft JhengHei", "Microsoft New Tai Lue", "Microsoft PhagsPa",
    "Microsoft Sans Serif", "Microsoft Tai Le", "Microsoft YaHei",
    "Mongolian Baiti", "MS Gothic", "MV Boli", "Myanmar Text", "Nirmala UI",
    "Palatino Linotype", "Segoe Print", "Segoe Script", "Segoe UI",
    "Segoe UI Emoji", "Segoe UI Historic", "Segoe UI Symbol", "SimSun",
    "Sylfaen", "Symbol", "Tahoma", "Times New Roman", "Trebuchet MS",
    "Verdana", "Webdings", "Wingdings", "Yu Gothic",
    // macOS core
    "American Typewriter", "Andale Mono", "Apple Chancery", "Apple Color Emoji",
    "Apple SD Gothic Neo", "Avenir", "Avenir Next", "Baskerville", "Big Caslon",
    "Chalkboard", "Chalkduster", "Charter", "Cochin", "Copperplate", "Didot",
    "Futura", "Geneva", "Gill Sans", "Helvetica", "Helvetica Neue", "Herculanum",
    "Hoefler Text", "Lucida Grande", "Luminari", "Marker Felt", "Menlo",
    "Monaco", "Noteworthy", "Optima", "Palatino", "Papyrus", "Phinster",
    "Rockwell", "San Francisco", "Savoye LET", "SignPainter", "Skia",
    "Snell Roundhand", "Tahoma", "Trattatello", "Zapfino",
    // Linux / cross-platform classics
    "Cantarell", "DejaVu Sans", "DejaVu Sans Mono", "DejaVu Serif",
    "FreeMono", "FreeSans", "FreeSerif", "Fira Code", "Fira Sans", "Hack",
    "IBM Plex Mono", "IBM Plex Sans", "IBM Plex Serif", "JetBrains Mono",
    "Liberation Mono", "Liberation Sans", "Liberation Serif", "Noto Mono",
    "Noto Sans", "Noto Serif", "Open Sans", "Roboto", "Roboto Mono",
    "Source Code Pro", "Source Sans Pro", "Source Serif Pro", "Ubuntu",
    "Ubuntu Mono",
    // Bundled with Paperling (always available)
    "Inter", "Merriweather", "Lora", "Source Serif 4", "Fira Sans",
    "JetBrains Mono",
];

interface WideWindow { queryLocalFonts?: () => Promise<Array<{ family: string }>> }

/** Strategy 1: exact enumeration where the API exists and is permitted. */
async function viaLocalFontsApi(): Promise<string[]> {
    try {
        const fonts = (window as WideWindow).queryLocalFonts;
        if (typeof fonts !== "function") return [];
        const list = await fonts.call(window);
        return [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    } catch {
        // Denied / unsupported / no user gesture — fall through to probing.
        return [];
    }
}

const TEST_STRING = "mmmwwwiiilll1iltyLI@%";
/** Base families every platform resolves. A candidate is "installed" when
 *  rendering through it changes ANY base measurement. */
const BASE_FAMILIES = ["monospace", "serif", "sans-serif"] as const;

function measureWidth(family: string, base: string): number {
    const span = document.createElement("span");
    span.style.position = "absolute";
    span.style.left = "-9999px";
    span.style.top = "0";
    span.style.whiteSpace = "nowrap";
    span.style.fontSize = "72px";
    span.style.fontFamily = family ? `"${family}", ${base}` : base;
    span.textContent = TEST_STRING;
    document.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return width;
}

/** Strategy 2: permission-free width probing against the candidate list. */
function viaProbing(): string[] {
    const baseWidths = new Map<string, number>(
        BASE_FAMILIES.map((b) => [b, measureWidth("", b)]),
    );
    const found: string[] = [];
    for (const family of CANDIDATE_FAMILIES) {
        for (const base of BASE_FAMILIES) {
            const baseW = baseWidths.get(base)!;
            // >0.5px at 72px font size = genuinely different glyphs, not rounding.
            if (Math.abs(measureWidth(family, base) - baseW) > 0.5) {
                found.push(family);
                break;
            }
        }
    }
    return found.sort((a, b) => a.localeCompare(b));
}

let cache: string[] | null = null;
let inFlight: Promise<string[]> | null = null;

/** Lazily compute (once per session) the sorted list of installed families. */
export function getInstalledFontFamilies(): Promise<string[]> {
    if (cache) return Promise.resolve(cache);
    if (!inFlight) {
        inFlight = (async () => {
            const fromApi = await viaLocalFontsApi();
            cache = fromApi.length > 0 ? fromApi : viaProbing();
            return cache;
        })();
    }
    return inFlight;
}

/** Test-only: reset the memoised state. */
export function resetFontDiscoveryCache(): void {
    cache = null;
    inFlight = null;
}

/** Test-only: the candidate list the probe uses. */
export function candidateFontFamilies(): readonly string[] {
    return CANDIDATE_FAMILIES;
}
