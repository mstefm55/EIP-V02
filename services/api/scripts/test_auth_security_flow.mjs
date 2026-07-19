import crypto from "node:crypto";
import { generate } from "otplib";
import { buildServer } from "../src/server.js";

const DEFAULT_ORIGIN = "http://localhost:5175";
const DEFAULT_BAD_ORIGIN = "http://malicious.local";

function normalize(value, fallback = "") {
  const v = String(value ?? "").trim();
  return v || fallback;
}

function parseSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers["set-cookie"] || response.headers.get?.("set-cookie");
  if (!single) return [];
  return Array.isArray(single) ? single : [single];
}

function cookieValue(setCookies, name) {
  const prefix = `${name}=`;
  const match = setCookies.find((entry) => String(entry).startsWith(prefix));
  if (!match) return null;
  const firstPart = String(match).split(";")[0];
  const value = firstPart.slice(prefix.length);
  return decodeURIComponent(value);
}

function cookieHeaderFromSetCookies(setCookies) {
  return setCookies
    .map((entry) => String(entry).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function parseJsonBody(response) {
  try {
    return JSON.parse(response.body || "{}");
  } catch {
    return {};
  }
}

async function main() {
  const tenantCode = normalize(process.env.AUTH_TEST_TENANT_CODE, "v2seed");
  const login = normalize(process.env.AUTH_TEST_LOGIN, "v2.workbench.admin");
  const password = normalize(process.env.AUTH_TEST_PASSWORD, "V2Smoke!Pass123");
  const origin = normalize(process.env.AUTH_TEST_ORIGIN, DEFAULT_ORIGIN);
  const badOrigin = normalize(process.env.AUTH_TEST_BAD_ORIGIN, DEFAULT_BAD_ORIGIN);

  if (!password) {
    throw new Error("AUTH_TEST_PASSWORD is required.");
  }

  const app = await buildServer();
  const summary = {
    ok: true,
    checks: {},
  };

  try {
    const tenant = await app.loadTenant(tenantCode);
    if (!tenant?.tenant_id) {
      throw new Error(`Tenant not found for code/id: ${tenantCode}. Run seed first.`);
    }
    const identity = await app.loadIdentity(tenant.tenant_id, login);
    if (!identity?.id) {
      throw new Error(`Identity not found for login: ${login}. Run seed first.`);
    }

    await app.db.query(
      `
      UPDATE eip_auth.auth_identity
      SET is_locked = false,
          attrs = COALESCE(attrs, '{}'::jsonb)
                - 'failed_login_count'
                - 'last_failed_login_at'
                - 'login_lock_until',
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND id = $2::uuid
      `,
      [tenant.tenant_id, identity.id]
    );

    const loginPayload = { tenantCode, login, password };

    const originBlocked = await app.inject({
      method: "POST",
      url: "/api/eip/auth/login/password",
      headers: { origin: badOrigin },
      payload: loginPayload,
    });
    summary.checks.origin_forbidden = originBlocked.statusCode;
    if (originBlocked.statusCode !== 403) {
      throw new Error(`Expected 403 for untrusted origin, got ${originBlocked.statusCode}`);
    }

    const passwordLogin = await app.inject({
      method: "POST",
      url: "/api/eip/auth/login/password",
      headers: { origin },
      payload: loginPayload,
    });
    summary.checks.password_login = passwordLogin.statusCode;
    let authResponse = passwordLogin;
    const passwordLoginBody = parseJsonBody(passwordLogin);

    if (passwordLogin.statusCode !== 200) {
      const stepUpCode = normalize(passwordLoginBody.error);
      if (passwordLogin.statusCode !== 403 || !["TOTP_REQUIRED", "TOTP_ENROLL_REQUIRED"].includes(stepUpCode)) {
        throw new Error(`Password login failed with ${passwordLogin.statusCode}.`);
      }

      summary.checks.password_login_step_up = stepUpCode;
      const totpBootstrapStepUp = await app.inject({
        method: "POST",
        url: "/api/eip/auth/totp/bootstrap",
        headers: { origin },
        payload: loginPayload,
      });
      summary.checks.totp_bootstrap_step_up = totpBootstrapStepUp.statusCode;
      if (totpBootstrapStepUp.statusCode !== 200) {
        throw new Error(`Expected totp bootstrap for step-up 200, got ${totpBootstrapStepUp.statusCode}`);
      }
      const stepUpUri = normalize(parseJsonBody(totpBootstrapStepUp).uri);
      const stepUpSecret = stepUpUri ? new URL(stepUpUri).searchParams.get("secret") : "";
      if (!stepUpSecret) {
        throw new Error("Step-up TOTP bootstrap URI missing secret.");
      }
      const stepUpToken = await generate({ secret: stepUpSecret, period: 30, digits: 6 });
      const totpLoginStepUp = await app.inject({
        method: "POST",
        url: "/api/eip/auth/login/totp",
        headers: { origin },
        payload: {
          ...loginPayload,
          token: stepUpToken,
        },
      });
      summary.checks.totp_login_step_up = totpLoginStepUp.statusCode;
      if (totpLoginStepUp.statusCode !== 200) {
        throw new Error(`Expected totp step-up login 200, got ${totpLoginStepUp.statusCode}`);
      }
      authResponse = totpLoginStepUp;
    }

    const setCookies = parseSetCookies(authResponse);
    const sid = cookieValue(setCookies, "sid");
    const csrf = cookieValue(setCookies, "csrf");
    const did = cookieValue(setCookies, "did");
    summary.checks.cookies = {
      sid: Boolean(sid),
      csrf: Boolean(csrf),
      did: Boolean(did),
    };
    if (!sid || !csrf || !did) {
      throw new Error("Expected sid/csrf/did cookies after login.");
    }

    const authCookieHeader = cookieHeaderFromSetCookies(setCookies);

    const whoami = await app.inject({
      method: "GET",
      url: "/api/eip/auth/whoami",
      headers: {
        origin,
        cookie: authCookieHeader,
      },
    });
    summary.checks.whoami = whoami.statusCode;
    if (whoami.statusCode !== 200) {
      throw new Error(`Expected whoami 200, got ${whoami.statusCode}`);
    }

    const tamperedCookieHeader = authCookieHeader.replace(
      /did=[^;]+/i,
      `did=${crypto.randomUUID()}`
    );
    const whoamiTamperedDevice = await app.inject({
      method: "GET",
      url: "/api/eip/auth/whoami",
      headers: {
        origin,
        cookie: tamperedCookieHeader,
      },
    });
    summary.checks.whoami_tampered_device = whoamiTamperedDevice.statusCode;
    if (whoamiTamperedDevice.statusCode !== 401) {
      throw new Error(`Expected whoami with tampered device to return 401, got ${whoamiTamperedDevice.statusCode}`);
    }

    const logoutNoCsrf = await app.inject({
      method: "POST",
      url: "/api/eip/auth/logout",
      headers: {
        origin,
        cookie: authCookieHeader,
      },
    });
    summary.checks.logout_without_csrf = logoutNoCsrf.statusCode;
    if (logoutNoCsrf.statusCode !== 403) {
      throw new Error(`Expected logout without csrf to fail with 403, got ${logoutNoCsrf.statusCode}`);
    }

    const logoutBadOrigin = await app.inject({
      method: "POST",
      url: "/api/eip/auth/logout",
      headers: {
        origin: badOrigin,
        cookie: authCookieHeader,
        "x-csrf": csrf,
      },
    });
    summary.checks.logout_bad_origin = logoutBadOrigin.statusCode;
    if (logoutBadOrigin.statusCode !== 403) {
      throw new Error(`Expected logout with bad origin to fail with 403, got ${logoutBadOrigin.statusCode}`);
    }

    const logoutWithCsrf = await app.inject({
      method: "POST",
      url: "/api/eip/auth/logout",
      headers: {
        origin,
        cookie: authCookieHeader,
        "x-csrf": csrf,
      },
    });
    summary.checks.logout_with_csrf = logoutWithCsrf.statusCode;
    if (logoutWithCsrf.statusCode !== 200) {
      throw new Error(`Expected logout with csrf 200, got ${logoutWithCsrf.statusCode}`);
    }

    const whoamiAfterLogout = await app.inject({
      method: "GET",
      url: "/api/eip/auth/whoami",
      headers: {
        origin,
        cookie: authCookieHeader,
      },
    });
    summary.checks.whoami_after_logout = whoamiAfterLogout.statusCode;
    if (whoamiAfterLogout.statusCode !== 401) {
      throw new Error(`Expected whoami after logout 401, got ${whoamiAfterLogout.statusCode}`);
    }

    const otpRequest = await app.inject({
      method: "POST",
      url: "/api/eip/auth/request-otp",
      headers: { origin },
      payload: loginPayload,
    });
    summary.checks.request_otp = otpRequest.statusCode;
    if (otpRequest.statusCode !== 200) {
      throw new Error(`Expected request-otp 200, got ${otpRequest.statusCode}`);
    }

    const totpBootstrap = await app.inject({
      method: "POST",
      url: "/api/eip/auth/totp/bootstrap",
      headers: { origin },
      payload: loginPayload,
    });
    summary.checks.totp_bootstrap = totpBootstrap.statusCode;
    if (totpBootstrap.statusCode !== 200) {
      throw new Error(`Expected totp bootstrap 200, got ${totpBootstrap.statusCode}`);
    }

    const bootstrapBody = parseJsonBody(totpBootstrap);
    const uri = normalize(bootstrapBody.uri);
    if (!uri) {
      throw new Error("TOTP bootstrap did not return uri.");
    }
    const secret = new URL(uri).searchParams.get("secret");
    if (!secret) {
      throw new Error("TOTP bootstrap URI missing secret.");
    }

    const validToken = await generate({
      secret,
      period: 30,
      digits: 6,
    });

    const totpLogin = await app.inject({
      method: "POST",
      url: "/api/eip/auth/login/totp",
      headers: { origin },
      payload: {
        ...loginPayload,
        token: validToken,
      },
    });
    summary.checks.totp_login = totpLogin.statusCode;
    if (totpLogin.statusCode !== 200) {
      throw new Error(`Expected totp login 200, got ${totpLogin.statusCode}`);
    }

    const totpCookies = parseSetCookies(totpLogin);
    const totpCookieHeader = cookieHeaderFromSetCookies(totpCookies);
    const totpSid = cookieValue(totpCookies, "sid");
    if (!totpSid) {
      throw new Error("Expected sid cookie after totp login.");
    }
    await app.db.query(
      `
      UPDATE eip_auth.auth_session
      SET attrs = COALESCE(attrs, '{}'::jsonb)
                || jsonb_build_object(
                     'last_seen_at',
                     (now() - interval '200 minutes')::text
                   )
      WHERE id = $1::uuid
      `,
      [totpSid]
    );
    const whoamiAfterIdleAging = await app.inject({
      method: "GET",
      url: "/api/eip/auth/whoami",
      headers: {
        origin,
        cookie: totpCookieHeader,
      },
    });
    summary.checks.whoami_after_idle_timeout = whoamiAfterIdleAging.statusCode;
    if (whoamiAfterIdleAging.statusCode !== 401) {
      throw new Error(`Expected idle-timeout session to return 401, got ${whoamiAfterIdleAging.statusCode}`);
    }
  } catch (error) {
    summary.ok = false;
    summary.error = error?.message || String(error);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
    return;
  } finally {
    await app.close();
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error?.message || String(error),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
});
