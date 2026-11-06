import { describe, expect, it, vi } from "vitest";
import { buildHtmlDocument, htmlViewCsp, localAssetPath, type HtmlAssetReader } from "./htmlDocument";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const build = (html: string, allowRemoteImages = true) => buildHtmlDocument(html, { baseDir: null, allowRemoteImages });

describe("buildHtmlDocument (#295)", () => {
    it("removes scripts, refresh redirects and base tags", async () => {
        const out = await build(`<html><head><script src="x.js"></script><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test/"></head><body><script>alert(1)</script><p>hi</p></body></html>`);
        const doc = parse(out);
        expect(doc.querySelector("script")).toBeNull();
        expect(doc.querySelector("base")).toBeNull();
        expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
        expect(doc.querySelector("p")?.textContent).toBe("hi");
    });

    it("keeps the page's own styles and layout", async () => {
        const out = await build(`<!doctype html><html><head><style>h1{color:red}</style></head><body><div class="grid" style="display:grid"><h1>Title</h1></div></body></html>`);
        expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
        const doc = parse(out);
        expect(doc.querySelector("style")?.textContent).toContain("color:red");
        expect(doc.querySelector(".grid")?.getAttribute("style")).toBe("display:grid");
    });

    it("puts the CSP first in the real head, even when a comment mentions <head>", async () => {
        const out = await build(`<!-- <head> --><html><head><title>t</title></head><body>x</body></html>`);
        const first = parse(out).head.firstElementChild;
        expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    });

    it("adds a head to a bare fragment", async () => {
        const out = await build("<p>only a fragment</p>");
        expect(parse(out).head.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
    });

    it("keeps in-page anchors live and stops links leaving the frame", async () => {
        const out = await build(`<a id="a" href="#top">up</a><a id="b" href="https://example.com">out</a><a id="c" href="other.html">rel</a>`);
        const doc = parse(out);
        expect(doc.getElementById("a")?.getAttribute("target")).toBe("_self");
        expect(doc.getElementById("b")?.getAttribute("target")).toBe("_blank");
        expect(doc.getElementById("c")?.getAttribute("target")).toBe("_blank");
    });

    it("follows the remote images setting", async () => {
        expect(htmlViewCsp(true)).toContain("img-src data: https:");
        expect(htmlViewCsp(false)).toContain("img-src data:;");
        expect(htmlViewCsp(false)).not.toContain("https:");
        expect(htmlViewCsp(true)).not.toContain("script-src");
        expect(htmlViewCsp(true)).toContain("default-src 'none'");
        const out = await build("<p>x</p>", false);
        expect(out).not.toContain("https:");
    });

    it("inlines images and stylesheets from the document's folder", async () => {
        const assets: HtmlAssetReader = {
            readImage: vi.fn(async () => new TextEncoder().encode("abc").buffer as ArrayBuffer),
            readText: vi.fn(async () => "body{margin:0}"),
        };
        const out = await buildHtmlDocument(
            `<html><head><link rel="stylesheet" href="./css/site.css?v=2"></head><body><img src="img/a%20b.png"><img src="https://example.com/x.png"></body></html>`,
            { baseDir: "C:/site", allowRemoteImages: true, assets },
        );
        const doc = parse(out);
        expect(assets.readText).toHaveBeenCalledWith("C:/site", "css/site.css");
        expect(assets.readImage).toHaveBeenCalledWith("C:/site", "img/a b.png");
        expect(assets.readImage).toHaveBeenCalledTimes(1);
        expect(doc.querySelector("link")).toBeNull();
        expect(doc.querySelector("style")?.textContent).toBe("body{margin:0}");
        const [local, remote] = [...doc.querySelectorAll("img")];
        expect(local.getAttribute("src")).toBe(`data:image/png;base64,${btoa("abc")}`);
        expect(remote.getAttribute("src")).toBe("https://example.com/x.png");
    });

    it("never reads outside the document's folder", async () => {
        const assets: HtmlAssetReader = { readImage: vi.fn(), readText: vi.fn() };
        await buildHtmlDocument(
            `<link rel="stylesheet" href="../secret.css"><img src="../../etc/passwd.png"><img src="C:/Windows/x.png"><img src="/etc/x.png"><img src="%2e%2e/x.png">`,
            { baseDir: "/site", allowRemoteImages: true, assets },
        );
        expect(assets.readImage).not.toHaveBeenCalled();
        expect(assets.readText).not.toHaveBeenCalled();
    });

    it("survives a missing asset", async () => {
        const assets: HtmlAssetReader = {
            readImage: vi.fn(async () => { throw new Error("nope"); }),
            readText: vi.fn(async () => { throw new Error("nope"); }),
        };
        const out = await buildHtmlDocument(`<link rel="stylesheet" href="a.css"><img src="a.png">`, { baseDir: "/site", allowRemoteImages: true, assets });
        expect(parse(out).querySelector("img")?.getAttribute("src")).toBe("a.png");
    });
});

describe("localAssetPath", () => {
    it("accepts plain relative paths", () => {
        expect(localAssetPath("./a/b.png")).toBe("a/b.png");
        expect(localAssetPath("b.css?x=1#y")).toBe("b.css");
    });
    it("refuses URLs, fragments and escapes", () => {
        for (const ref of ["https://x.test/a.png", "data:image/png;base64,AA", "//x.test/a.png", "#a", "", null, "../a.png", "a/../../b.png"]) {
            expect(localAssetPath(ref)).toBeNull();
        }
    });
});
