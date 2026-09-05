import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const loginPanelPath = new URL("../src/components/shell/LoginPanel.jsx", import.meta.url);
const authHookPath = new URL("../src/hooks/useAuthSession.js", import.meta.url);

test("login panel restores automatic organisation lookup and removes hard-coded demo admin", async () => {
  const source = await readFile(loginPanelPath, "utf8");

  assert.match(source, /onResolveOrganisations/);
  assert.match(source, /onBlur=\{\(\) => \{/);
  assert.match(source, /resolveOrganisations\(\)/);
  assert.match(source, /organisations\.length/);
  assert.doesNotMatch(source, /v2\.workbench\.admin/);
});

test("auth hook sends organisation lookup to API and uses resolved canonical identity login", async () => {
  const source = await readFile(authHookPath, "utf8");

  assert.match(source, /\/api\/eip\/auth\/organisations/);
  assert.match(source, /form\.identityLogin \|\| form\.login/);
  assert.match(source, /identity_login/);
});

test("auth flow de-duplicates organisation lookups and refreshes session without login-screen flicker", async () => {
  const source = await readFile(authHookPath, "utf8");

  assert.match(source, /organisationLookupCacheRef/);
  assert.match(source, /organisationLookupInFlightRef/);
  assert.match(source, /refresh\(\{ silent: true \}\)/);
  assert.match(source, /if \(!silent\) setLoading\(true\)/);
});
