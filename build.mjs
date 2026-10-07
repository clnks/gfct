// Packs the pages in src/ into one file, then encrypts it with the passcode
// and writes index.html (the only page GitHub serves).
// Usage: node build.mjs            (reads the passcode from .passcode)
//        PASSCODE=new-code node build.mjs
import { readFile, writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";

const ITER = 300000;
const pass = (process.env.PASSCODE || (await readFile(".passcode", "utf8").catch(() => ""))).trim();
if (!pass) { console.error("No passcode. Put one in .passcode (one line), then run node build.mjs again."); process.exit(1); }

const icon = "data:image/png;base64," + (await readFile("icon.png")).toString("base64");
let page = await readFile("src/page.html", "utf8");

// Inline every local script so the page is a single file
const scripts = [...page.matchAll(/<script src="([a-z0-9-]+\.js)"><\/script>/g)].map((m) => m[1]);
for (const f of scripts) {
  const js = (await readFile("src/" + f, "utf8")).replace(/<\/script/gi, "<\\/script");
  page = page.replace(`<script src="${f}"></script>`, () => `<script>\n${js}\n</script>`);
}

// Inline images so they sit behind the passcode too
const imgs = [...new Set([...page.matchAll(/img\/([a-z0-9_-]+\.(?:jpg|png))/gi)].map((m) => m[1]))];
for (const f of imgs) {
  const mime = f.endsWith(".png") ? "image/png" : "image/jpeg";
  const uri = `data:${mime};base64,` + (await readFile("src/img/" + f)).toString("base64");
  page = page.split("img/" + f).join(uri);
}

// Display-name swaps live in src/rename.json (kept locally): [[from, to], ...]
for (const [from, to] of JSON.parse(await readFile("src/rename.json", "utf8").catch(() => "[]"))) page = page.split(from).join(to);

const head = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#4D7A57">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="GFCT"><link rel="icon" type="image/png" href="${icon}"><link rel="apple-touch-icon" href="${icon}">
<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>`;
const html = head + page + "</body></html>";

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(html)));

const b64 = (b) => Buffer.from(b).toString("base64");
const payload = JSON.stringify({ s: b64(salt), i: b64(iv), c: b64(ct), n: ITER });
const shell = (await readFile("lock.html", "utf8")).split("__ICON__").join(icon).replace("__PAYLOAD__", () => payload);
await writeFile("index.html", shell);
console.log(`Built index.html (${(shell.length / 1024 / 1024).toFixed(1)} MB, encrypted; ${scripts.length} scripts, ${imgs.length} images inlined)`);
