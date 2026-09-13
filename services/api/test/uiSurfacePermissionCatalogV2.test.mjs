import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  fetchSurfaceCatalog,
  getSurfaceRequiredPermissions,
  surfaceMetadataAllows,
} from "../src/routes/ui_surface.js";

const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const routeSource = readFileSync(new URL("../src/routes/ui_surface.js", import.meta.url), "utf8");

function surfaceAttrs(requiredPermissions = []) {
  return {
    realm: "EIP",
    surface_nav: {
      label: requiredPermissions.length ? "Tenant Requests" : "Dashboard",
      order: requiredPermissions.length ? 20 : 10,
      enabled: true,
      requires_any_permission: requiredPermissions,
    },
  };
}

function catalogRow({ code, attrs, order }) {
  return {
    code,
    title: code === "owner_tenant_requests" ? "Tenant Requests" : "Dashboard",
    version: 1,
    attrs,
    nav_label: code === "owner_tenant_requests" ? "Tenant Requests" : "Dashboard",
    nav_order: order,
    is_default: code === "owner_dashboard",
    asset_key: null,
    nav_icon: null,
    nav_enabled: true,
    nav_hint: null,
    module: "OWNER_ADMIN",
    surface_kind: "admin",
    realm: "EIP",
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
  };
}

function makeCatalogApp() {
  const rows = [
    catalogRow({ code: "owner_dashboard", attrs: surfaceAttrs(), order: 10 }),
    catalogRow({
      code: "owner_tenant_requests",
      attrs: surfaceAttrs(["PLATFORM_TENANT_REQUEST_READ"]),
      order: 20,
    }),
  ];

  return {
    db: {
      async query(sql, params) {
        assert.match(String(sql), /FROM eip_core\.ui_surface/);
        assert.match(String(sql), /\battrs\b/);
        assert.deepEqual(params, ["EIP", TENANT_ID]);
        return { rows, rowCount: rows.length };
      },
    },
  };
}

test("surface permission metadata is normalized from the governed navigation contract", () => {
  assert.deepEqual(
    getSurfaceRequiredPermissions(surfaceAttrs([
      " platform_tenant_request_read ",
      "PLATFORM_TENANT_REQUEST_READ",
    ])),
    ["PLATFORM_TENANT_REQUEST_READ"]
  );
});

test("unrestricted surfaces remain visible without permissions", () => {
  assert.equal(surfaceMetadataAllows(surfaceAttrs(), []), true);
});

test("platform-only Tenant Requests metadata is hidden from ordinary tenant authority", () => {
  const attrs = surfaceAttrs(["PLATFORM_TENANT_REQUEST_READ"]);
  assert.equal(surfaceMetadataAllows(attrs, ["OWNER_ADMIN_CONSOLE_READ"]), false);
  assert.equal(surfaceMetadataAllows(attrs, ["OWNER_ADMIN_TENANT_REQUEST_READ"]), false);
});

test("explicit platform permission unlocks platform-only surface metadata", () => {
  const attrs = surfaceAttrs(["PLATFORM_TENANT_REQUEST_READ"]);
  assert.equal(surfaceMetadataAllows(attrs, ["PLATFORM_TENANT_REQUEST_READ"]), true);
});

test("surface catalog filters platform-only navigation for an ordinary Owner Admin", async () => {
  const items = await fetchSurfaceCatalog(makeCatalogApp(), {
    tenantId: TENANT_ID,
    publicOnly: false,
    realm: "EIP",
    grantedPermissions: ["OWNER_ADMIN_CONSOLE_READ"],
  });

  assert.deepEqual(items.map((item) => item.code), ["owner_dashboard"]);
});

test("surface catalog includes platform-only navigation for the explicit platform operator", async () => {
  const items = await fetchSurfaceCatalog(makeCatalogApp(), {
    tenantId: TENANT_ID,
    publicOnly: false,
    realm: "EIP",
    grantedPermissions: ["OWNER_ADMIN_CONSOLE_READ", "PLATFORM_TENANT_REQUEST_READ"],
  });

  assert.deepEqual(items.map((item) => item.code), ["owner_dashboard", "owner_tenant_requests"]);
});

test("public catalogue authority cannot discover permission-gated surfaces", async () => {
  const items = await fetchSurfaceCatalog(makeCatalogApp(), {
    tenantId: TENANT_ID,
    publicOnly: true,
    realm: "EIP",
    grantedPermissions: [],
  });

  assert.deepEqual(items.map((item) => item.code), ["owner_dashboard"]);
});

test("catalogue and deep-link routes enforce the same permission metadata", () => {
  assert.match(routeSource, /grantedPermissions:\s*s\.session\.permission_codes/);
  assert.match(routeSource, /grantedPermissions:\s*\[\]/);
  assert.match(
    routeSource,
    /!surface\s*\|\|\s*!surfaceMetadataAllows\(surface,\s*s\.session\.permission_codes\)/
  );
  assert.match(routeSource, /!surface\s*\|\|\s*!surfaceMetadataAllows\(surface,\s*\[\]\)/);
});
