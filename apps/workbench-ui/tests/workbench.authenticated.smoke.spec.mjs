import { test, expect } from "@playwright/test";
import { SHARED_PASSWORD } from "./global-setup.mjs";

const TENANT_CODE = String(process.env.E2E_TENANT_CODE || "v2seed").trim();
const ADMIN_LOGIN = String(process.env.E2E_ADMIN_LOGIN || "v2.workbench.admin").trim();
const LIMITED_LOGIN = String(process.env.E2E_LIMITED_LOGIN || "v2.workbench.limited").trim();
const UI_ORIGIN = String(process.env.E2E_UI_ORIGIN || "http://localhost:5175").trim();
const API_ORIGIN = String(process.env.E2E_API_ORIGIN || "http://localhost:4010").trim();
const IS_SINGLE_ORIGIN = new URL(UI_ORIGIN).origin === new URL(API_ORIGIN).origin;
const EXPECT_SECURE_COOKIE = new URL(API_ORIGIN).protocol === "https:";

function makeCode(prefix) {
  return `${prefix}_${Date.now()}`.replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
}

async function login(page, { login }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const loginResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/api/eip/auth/login/password") &&
        response.request().method() === "POST";
    });

    await page.getByLabel("Tenant Code").fill(TENANT_CODE);
    await page.getByLabel("Tenant Id (optional)").fill("");
    await page.getByLabel("Login").fill(login);
    await page.getByLabel("Password").fill(SHARED_PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();

    const loginResponse = await loginResponsePromise;
    if (loginResponse.status() === 200) {
      return loginResponse;
    }

    if (loginResponse.status() === 429 && attempt < 3) {
      await page.waitForTimeout(1200);
      continue;
    }

    expect(loginResponse.status()).toBe(200);
    return loginResponse;
  }

  throw new Error("Login failed after retries.");
}

async function waitForApi(page, { path, method = "GET", status = 200 }) {
  return page.waitForResponse((response) => {
    return response.url().includes(path) &&
      response.request().method() === method &&
      response.status() === status;
  });
}

test("authenticated core/ecom workbench render through UI-engine path", async ({ page }) => {
  const seenWorkbenchUrls = [];
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/eip/process/workbench/")) {
      seenWorkbenchUrls.push(url);
    }
  });

  await page.goto("/?surface=core_process_workbench");
  const loginResponse = await login(page, { login: ADMIN_LOGIN });

  const loginHeaders = loginResponse.headers();
  if (!IS_SINGLE_ORIGIN) {
    expect(loginHeaders["access-control-allow-origin"]).toBe(UI_ORIGIN);
    expect(loginHeaders["access-control-allow-credentials"]).toBe("true");
  }

  const catalogResponse = await page.waitForResponse((response) => {
    return response.url().includes("/api/eip/ui/surfaces") &&
      !response.url().includes("/api/eip/ui/surfaces/") &&
      response.status() === 200;
  });
  expect(catalogResponse.status()).toBe(200);

  const coreSurfaceResponse = await page.waitForResponse((response) => {
    return response.url().includes("/api/eip/ui/surfaces/core_process_workbench") &&
      response.status() === 200;
  });
  if (!IS_SINGLE_ORIGIN) {
    expect(coreSurfaceResponse.headers()["access-control-allow-origin"]).toBe(UI_ORIGIN);
  }

  await expect(page.locator('button[data-nav-key="__process_workbench__"]')).toHaveClass(/active/);
  await expect(page.getByText("Process Builder Workbench")).toBeVisible();
  await expect(page.getByText("Process Catalog")).toBeVisible();
  await expect(page.getByText("Definition Studio")).toBeVisible();

  await page.waitForResponse((response) => {
    return response.url().includes("/api/eip/process/workbench/catalog") &&
      response.status() === 200;
  });

  await page.waitForResponse((response) => {
    return response.url().includes("/api/eip/process/workbench/defs/") &&
      response.status() === 200;
  });

  const cookieHeader = await page.evaluate(() => document.cookie);
  expect(cookieHeader).toContain("csrf=");
  expect(cookieHeader).not.toContain("sid=");

  const cookies = await page.context().cookies(API_ORIGIN);
  const sidCookie = cookies.find((cookie) => cookie.name === "sid");
  const csrfCookie = cookies.find((cookie) => cookie.name === "csrf");
  expect(sidCookie).toBeTruthy();
  expect(csrfCookie).toBeTruthy();
  expect(sidCookie?.httpOnly).toBe(true);
  expect(sidCookie?.sameSite).toBe("Lax");
  expect(sidCookie?.secure).toBe(EXPECT_SECURE_COOKIE);
  expect(csrfCookie?.httpOnly).toBe(false);

  const whoami = await page.context().request.get(`${API_ORIGIN}/api/eip/auth/whoami`, {
    headers: { Origin: UI_ORIGIN },
  });
  expect(whoami.status()).toBe(200);

  const badLogout = await page.context().request.post(`${API_ORIGIN}/api/eip/auth/logout`, {
    headers: { Origin: UI_ORIGIN },
  });
  expect(badLogout.status()).toBe(403);

  const logoutResponsePromise = page.waitForResponse((response) => {
    return response.url().includes("/api/eip/auth/logout") &&
      response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  const logoutResponse = await logoutResponsePromise;
  expect(logoutResponse.status()).toBe(200);
  await expect(page.getByText("Identity Gateway").first()).toBeVisible();

  const whoamiAfterLogout = await page.context().request.get(`${API_ORIGIN}/api/eip/auth/whoami`, {
    headers: { Origin: UI_ORIGIN },
  });
  expect(whoamiAfterLogout.status()).toBe(401);

  await page.goto("/?surface=ecom_process_workbench");
  await login(page, { login: ADMIN_LOGIN });
  await expect(page.getByText("Process Builder Workbench")).toBeVisible();

  expect(seenWorkbenchUrls.some((url) => url.includes("/api/eip/process/workbench/catalog"))).toBe(true);
  expect(seenWorkbenchUrls.some((url) => url.includes("/api/eip/process/workbench/defs/"))).toBe(true);
});

test("process builder supports governed authoring for defs/templates/bindings", async ({ page }) => {
  const processCode = makeCode("W19_DEF");

  await page.goto("/?surface=core_process_workbench");
  await login(page, { login: ADMIN_LOGIN });
  await expect(page.getByText("Process Builder Workbench")).toBeVisible();

  const definitionSection = page.locator("section.card", { hasText: "Definition Studio" });
  const codeInput = definitionSection.getByLabel("Code");
  const newDraftButton = definitionSection.getByRole("button", { name: "New" });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await newDraftButton.click();
    if (await codeInput.isEnabled()) {
      break;
    }
    if (attempt < 3) {
      await page.waitForTimeout(250);
    }
  }
  await expect(codeInput).toBeEnabled();

  await codeInput.fill(processCode);
  await definitionSection.getByLabel("Name").fill("Wave 0019 Authoring Test");
  await definitionSection.getByLabel("Module").fill("process");
  await definitionSection.getByLabel("Service Object Type").fill("sales_order");
  await definitionSection.getByLabel("Service Object Category").fill("sales");
  await definitionSection.getByLabel("Graph Initial Node").fill("draft");

  await definitionSection.getByRole("button", { name: "Show JSON" }).click();
  await definitionSection.getByLabel("JSON section").selectOption({ label: "Graph Nodes (JSON)" });
  await definitionSection.locator('textarea[aria-label="Graph Nodes (JSON)"]').fill(
    JSON.stringify(
      [
        { id: "draft", type: "STEP", label: "Draft Stage" },
        { id: "done", type: "TERMINAL", label: "Done", is_terminal: true },
      ],
      null,
      2
    )
  );
  await definitionSection.getByLabel("JSON section").selectOption({ label: "Graph Transitions (JSON)" });
  await definitionSection.locator('textarea[aria-label="Graph Transitions (JSON)"]').fill(
    JSON.stringify(
      [
        {
          from: "draft",
          to: "done",
          action: "SUBMIT",
          edge_type: "DEFAULT",
          task_label: "Submit Order",
          macro_code: "order_submit_macro",
        },
      ],
      null,
      2
    )
  );
  await definitionSection.getByLabel("JSON section").selectOption({ label: "Graph Macros (JSON)" });
  await definitionSection.locator('textarea[aria-label="Graph Macros (JSON)"]').fill(
    JSON.stringify(
      {
        order_submit_macro: {
          code: "order_submit_macro",
          label: "Order Submit Macro",
          effects: [
            {
              type: "STATUS_SET",
              to: "ACTIVE",
              service_object_type: "sales_order",
              service_object_category: "sales",
            },
          ],
        },
      },
      null,
      2
    )
  );

  const createDefResponse = waitForApi(page, {
    path: "/api/eip/process/defs",
    method: "POST",
  });
  await definitionSection.getByRole("button", { name: "Save Draft" }).click();
  await createDefResponse;
  await expect(definitionSection.getByLabel("Code")).toHaveValue(processCode);

  const validateResponse = waitForApi(page, {
    path: "/validate",
    method: "POST",
  });
  await definitionSection.getByRole("button", { name: "Validate" }).click();
  await validateResponse;

  const publishResponse = waitForApi(page, {
    path: "/publish",
    method: "POST",
  });
  await definitionSection.getByRole("button", { name: "Publish" }).click();
  await publishResponse;

  const templateSection = page.locator("section.card", { hasText: "Task Template Workbench" });
  await expect(templateSection.getByRole("heading", { name: "Task Template Workbench" })).toBeVisible();
  await expect(templateSection.getByRole("button", { name: "New" })).toBeVisible();

  await page.getByRole("tab", { name: /Bindings/i }).click();
  const bindingSection = page.locator("section.card", { hasText: "Process Binding Workbench" });
  await expect(bindingSection.getByRole("heading", { name: "Process Binding Workbench" })).toBeVisible();
  await expect(bindingSection.getByRole("button", { name: "New" })).toBeVisible();
});

test("permission failures fail closed in the real UI path", async ({ page }) => {
  await page.goto("/?surface=core_process_workbench");
  await login(page, { login: LIMITED_LOGIN });

  await expect(page.getByText("Process Builder Workbench")).toBeVisible();
  await expect(page.getByText("Permission required", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Table error").first()).toBeVisible();
});
