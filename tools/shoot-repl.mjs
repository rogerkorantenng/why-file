/**
 * Photograph the REPL actually running: the banner, tab completion firing for real, and
 * commands producing real output — not the scripted `cli-demo.ts` run `tools/shoot.mjs`
 * already covers.
 *
 * Tab completion only activates when stdin is a real terminal (`readline` falls back to
 * dumb line input otherwise, and a literal Tab character gets typed rather than
 * triggering the completer), so this drives the REPL under an actual pty via `script`
 * (util-linux) rather than piping input the way `shoot.mjs` pipes the demo. Keystrokes,
 * including the Tab bytes, go to the real process; what comes back is what a terminal
 * would actually show, echoed completions and all.
 *
 *   node tools/shoot-repl.mjs
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { mkdirSync, globSync } from "node:fs";

const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const ROOT = new URL("..", import.meta.url).pathname;

// The same two accents `demo/layout.ts` defines, so this session reads as the same
// program `tools/shoot.mjs` already photographed.
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the REPL under a real pty (`script -qec`, not a pipe), sends each step's bytes
 * with a pause after, and returns everything the pty wrote — including readline's own
 * echo of what was typed and what Tab completed it to.
 */
async function runPtySession(env, steps) {
  const child = spawn("script", ["-qec", "node src/repl.ts", "/dev/null"], {
    cwd: ROOT,
    env: { ...process.env, ...env, TERM: "xterm-256color" },
  });
  let output = "";
  child.stdout.on("data", (d) => { output += d.toString("utf8"); });
  child.stderr.on("data", (d) => { output += d.toString("utf8"); });

  await wait(700); // banner
  for (const [send, pause] of steps) {
    child.stdin.write(send);
    await wait(pause);
  }
  await wait(400);
  try { child.stdin.end(); } catch {}
  await wait(300);
  try { child.kill("SIGKILL"); } catch {}
  return output;
}

async function shootRaw(tab, name, raw, light) {
  const clean = raw
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC title sequences
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, (m) => (m[m.length - 1] === "m" ? m : "")) // non-SGR CSI (cursor moves, erases) — SGR kept for ansiToHtml
    .replace(/\r/g, "");
  const html = ansiToHtml(clean, light ? LIGHT : DARK);
  const lineCount = clean.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").split("\n").length;
  await tab.setViewportSize({ width: 1180, height: Math.max(220, lineCount * 21 + 60) });
  await tab.setContent(page(html, light));
  await tab.screenshot({ path: `${OUT}${name}.png` });
  console.log(`wrote ${name}.png (${lineCount} lines)`);
}

const browser = await chromium.launch({
  executablePath: globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`)[0],
  args: ["--no-sandbox"],
});
const tab = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
mkdirSync(OUT, { recursive: true });

// Session 1: banner, then `cap<TAB>` completing to `capture`, then real capture output.
const session1 = await runPtySession(
  { ORACLE_BEDROCK: "off", ORACLE_COLOR: "always", COLUMNS: "100", ORACLE_STORE_PATH: `${ROOT}/.oracle/shoot-repl-1.json`, ORACLE_REPO_DIR: `${ROOT}/.oracle/shoot-repl-repo-1` },
  [
    ["cap", 200],
    ["\t", 300],
    ["\n", 700],
    ["exit", 100],
    ["\n", 200],
  ],
);
await shootRaw(tab, "repl-01-banner-tab-complete-capture", session1, false);

// Session 2: `revi<TAB>` completing the command, then a partial claim id `<TAB>`
// completing the argument, then `log` and `sweep` — two more commands, real output.
const session2 = await runPtySession(
  { ORACLE_BEDROCK: "off", ORACLE_COLOR: "always", COLUMNS: "100", ORACLE_STORE_PATH: `${ROOT}/.oracle/shoot-repl-1.json`, ORACLE_REPO_DIR: `${ROOT}/.oracle/shoot-repl-repo-1` },
  [
    ["revi", 200],
    ["\t", 250],
    [" claim_conv_6531525", 200],
    ["\t", 300],
    ["\n", 600],
    ["log", 150],
    ["\n", 400],
    ["sweep", 150],
    ["\n", 500],
    ["exit", 100],
    ["\n", 200],
  ],
);
await shootRaw(tab, "repl-02-argument-completion-log-sweep", session2, false);

// Same first session, on a light terminal — Oracle defines no background colour of its
// own, so this is the thing to check.
const session3 = await runPtySession(
  { ORACLE_BEDROCK: "off", ORACLE_COLOR: "always", ORACLE_THEME: "light", COLUMNS: "100", ORACLE_STORE_PATH: `${ROOT}/.oracle/shoot-repl-2.json`, ORACLE_REPO_DIR: `${ROOT}/.oracle/shoot-repl-repo-2` },
  [
    ["cap", 200],
    ["\t", 300],
    ["\n", 700],
    ["exit", 100],
    ["\n", 200],
  ],
);
await shootRaw(tab, "repl-03-light-terminal", session3, true);

await browser.close();
