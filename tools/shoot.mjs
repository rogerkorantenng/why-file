/**
 * Photograph Oracle's own terminal output.
 *
 * Oracle has no browser surface, so a screenshot is a picture of a terminal. This runs
 * the real demo at three widths and both terminal themes, converts the ANSI it wrote to
 * HTML in the same two accents the app prints, and photographs that. Nothing is mocked
 * up: what you see is what the command wrote.
 *
 *   node tools/shoot.mjs
 *
 * playwright-core is not a dependency of this app; it is resolved from said-out-loud's
 * node_modules, which is why this runs with NODE_PATH set. See docs/handoff/bee-design.md.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, globSync } from "node:fs";

const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const ROOT = new URL("..", import.meta.url).pathname;

// The two accents from src/demo/layout.ts, in the same words the spec uses.
const DARK = { "38;5;179": "#d7af87", "38;5;245": "#8a8a8a" };
const LIGHT = { "38;5;130": "#a35c00", "38;5;240": "#585858" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ansiToHtml(text, colours) {
  let out = "";
  let open = 0;
  for (const chunk of text.split(/(\x1b\[[0-9;]*m)/)) {
    const m = chunk.match(/^\x1b\[([0-9;]*)m$/);
    if (!m) { out += esc(chunk); continue; }
    const code = m[1];
    if (code === "0" || code === "") { out += "</span>".repeat(open); open = 0; }
    else if (code === "1") { out += '<span style="font-weight:700">'; open += 1; }
    else if (colours[code]) { out += `<span style="color:${colours[code]}">`; open += 1; }
  }
  return out + "</span>".repeat(open);
}

function page(body, light) {
  const bg = light ? "#f6f3ec" : "#0d0e11";
  const fg = light ? "#1d1f24" : "#d4d7dd";
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:${bg}}
pre{margin:0;padding:30px 32px;color:${fg};background:${bg};
    font:14px/1.5 "DejaVu Sans Mono","Liberation Mono",monospace;white-space:pre}
</style><pre>${body}</pre>`;
}

function run(columns, light) {
  return execFileSync("npx", ["tsx", "src/cli-demo.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, COLUMNS: String(columns), ORACLE_COLOR: "always", ORACLE_BEDROCK: process.env.ORACLE_BEDROCK ?? "off", ORACLE_THEME: light ? "light" : "dark" },
  }).split("\n");
}

const browser = await chromium.launch({
  executablePath: globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`)[0],
  args: ["--no-sandbox"],
});
const tab = await browser.newPage({ deviceScaleFactor: 2 });
mkdirSync(OUT, { recursive: true });

/** Sections are found by the step lines the demo prints, so a change to the demo changes
 * the screenshots rather than silently desyncing from them. */
function sectionsOf(lines) {
  const starts = [];
  lines.forEach((line, i) => {
    if (/^\x1b\[[0-9;]*m\s+\d\x1b\[0m {2}\x1b\[1m/.test(line)) starts.push(i);
  });
  const shots = [{ name: "00-masthead", from: 0, to: starts[0] ?? lines.length }];
  starts.forEach((from, i) => {
    const title = lines[from].replace(/\x1b\[[0-9;]*m/g, "").trim();
    const n = title.slice(0, title.indexOf(" "));
    shots.push({
      name: `${String(n).padStart(2, "0")}-${title.slice(title.indexOf(" ") + 1).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44)}`,
      from,
      to: starts[i + 1] ?? lines.length,
    });
  });
  return shots;
}

async function shoot(name, lines, colours, light, columns) {
  const body = [...lines];
  while (body.length && body[body.length - 1].replace(/\x1b\[[0-9;]*m/g, "").trim() === "") body.pop();
  if (body.length < 2) return;
  await tab.setViewportSize({ width: columns * 9 + 64, height: Math.max(220, body.length * 21 + 62) });
  await tab.setContent(page(ansiToHtml(body.join("\n"), colours), light));
  await tab.screenshot({ path: `${OUT}${name}.png` });
  console.log(`wrote ${name}.png`);
}

const wide = run(100, false);
for (const s of sectionsOf(wide)) await shoot(s.name, wide.slice(s.from, s.to), DARK, false, 100);

// The two widths the design has to survive, and the theme it must not assume.
const narrow = run(80, false);
await shoot("w80-narrow", narrow.slice(0, 46), DARK, false, 80);
const huge = run(200, false);
await shoot("w200-wide", huge.slice(0, 46), DARK, false, 200);
const light = run(100, true);
await shoot("light-terminal", light.slice(0, 46), LIGHT, true, 100);

await browser.close();
