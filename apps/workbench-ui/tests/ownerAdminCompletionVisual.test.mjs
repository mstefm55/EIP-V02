import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(uiRoot, relativePath), "utf8");
}

test("Owner Admin completion stylesheet loads after the shared stylesheet", () => {
  const main = read("src/main.jsx");
  const sharedIndex = main.indexOf('import "./styles.css"');
  const ownerIndex = main.indexOf('import "./ownerAdminCompletion.css"');

  assert.ok(sharedIndex >= 0);
  assert.ok(ownerIndex > sharedIndex);
});

test("Owner Admin completion rules stay scoped to the owner shell", () => {
  const css = read("src/ownerAdminCompletion.css");
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = cssWithoutComments
    .split("}")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.includes("{"));

  assert.ok(rules.length > 20);
  for (const rule of rules) {
    const selector = rule.slice(0, rule.indexOf("{")).trim();
    if (selector.startsWith("@")) continue;
    for (const part of selector.split(",")) {
      assert.match(part.trim(), /^\.owner-shell\b/);
    }
  }

  assert.doesNotMatch(css, /tenant_id/i);
  assert.doesNotMatch(css, /display\s*:\s*none[^}]*owner_connections/i);
});

test("Owner Admin completion theme uses dense control-plane treatments", () => {
  const css = read("src/ownerAdminCompletion.css");

  assert.match(css, /--oa-control-sidebar:\s*#172235/);
  assert.match(css, /owner-surface-button\.active/);
  assert.match(css, /owner-main/);
  assert.match(css, /table-wrap th/);
  assert.match(css, /minmax\(142px/);
});
