// Renders RULES.md to web/public/rules.html with stable heading ids (r1, r2, ...), no dependencies.
import { readFileSync, writeFileSync } from "node:fs";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
let html = "", list = false;
for (const line of readFileSync("RULES.md", "utf8").split("\n")) {
  const close = () => { if (list) { html += "</ul>"; list = false; } };
  let m;
  if ((m = line.match(/^# (.*)/))) { close(); html += `<h1>${inline(m[1])}</h1>`; }
  else if ((m = line.match(/^## (R\d+)\b(.*)/))) { close(); html += `<h2 id="${m[1].toLowerCase()}">${inline(m[1] + m[2])}</h2>`; }
  else if ((m = line.match(/^## (.*)/))) { close(); html += `<h2>${inline(m[1])}</h2>`; }
  else if ((m = line.match(/^- (.*)/))) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(m[1])}</li>`; }
  else if (line.trim()) { close(); html += `<p>${inline(line)}</p>`; }
}
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rounds — RULES</title>
<style>:root{color-scheme:dark light}body{font:15px/1.6 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;background:#000;color:#fafafa}@media(prefers-color-scheme:light){body{background:#fdfdfd;color:#0a0a0a}}h1,h2{letter-spacing:-.03em;font-weight:500}h2{margin-top:36px;border-top:1px solid #8884;padding-top:20px}code{font:13px ui-monospace,monospace;background:#8882;padding:1px 5px;border-radius:4px}a{color:inherit}h2:target{color:#44ffa4}</style>
<p><a href="./">← Rounds</a></p>${html}`;
writeFileSync("web/public/rules.html", page);
