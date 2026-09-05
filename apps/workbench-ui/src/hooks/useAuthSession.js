import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiFetch, describeApiError } from "../services/apiClient.js";

function buildLoginPayload(form) {
  const payload = {
    login: String(form.identityLogin || form.login || "").trim(),
    password: String(form.password || ""),
  };

  const tenantId = String(form.tenantId || "").trim();
  const tenantCode = String(form.tenantCode || "").trim();

  if (tenantId) payload.tenantId = tenantId;
  if (!tenantId && tenantCode) payload.tenantCode = tenantCode;
  return payload;
}

function normalizeSessionPayload(payload) {
  if (!payload || payload.ok !== true) return null;
  return {
    tenant_id: payload.tenant_id,
    identity_id: payload.identity_id,
    realm: payload.realm,
    device_id: payload.device_id || null,
    assurance: payload.assurance || null,
    expires_at: payload.expires_at || null,
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
  };
}

function normalizeOrganisation(payload) {
  if (!payload || typeof payload !== "object") return null;
  const id = String(payload.id || "").trim();
  const code = String(payload.code || "").trim();
  const name = String(payload.name || "").trim();
  const identityLogin = String(payload.identity_login || payload.login || "").trim();
  if (!id && !code) return null;
  return {
    id: id || null,
    code: code || null,
    name: name || code || id,
    identity_login: identityLogin || null,
  };
}

function useAuthSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const idleTimeoutRef = useRef(null);
  const organisationLookupCacheRef = useRef(new Map());
  const organisationLookupInFlightRef = useRef(new Map());

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch("/api/eip/auth/whoami");
      setSession(normalizeSessionPayload(payload));
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return { ok: false, error: "UNAUTHENTICATED" };
      }

      setSession(null);
      const message = describeApiError(err, "Unable to verify session.");
      setError(message);
      return { ok: false, error: message };
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resolveOrganisations = useCallback(async ({ login, password } = {}) => {
    const loginValue = String(login || "").trim().toLowerCase();
    const passwordValue = String(password || "");
    if (!loginValue) {
      return { ok: false, organisations: [], error: "Enter your email to load organisations." };
    }

    const cacheKey = loginValue;
    if (!passwordValue && organisationLookupCacheRef.current.has(cacheKey)) {
      return {
        ok: true,
        organisations: organisationLookupCacheRef.current.get(cacheKey),
        cached: true,
      };
    }

    if (!passwordValue && organisationLookupInFlightRef.current.has(cacheKey)) {
      return organisationLookupInFlightRef.current.get(cacheKey);
    }

    const lookupPromise = (async () => {
      try {
        const response = await apiFetch("/api/eip/auth/organisations", {
          method: "POST",
          body: {
            email: loginValue,
            ...(passwordValue ? { password: passwordValue } : {}),
          },
        });
        const organisations = Array.isArray(response?.organisations)
          ? response.organisations.map(normalizeOrganisation).filter(Boolean)
          : [];
        if (!passwordValue) {
          organisationLookupCacheRef.current.set(cacheKey, organisations);
        }
        return { ok: true, organisations };
      } catch (err) {
        return {
          ok: false,
          organisations: [],
          error: describeApiError(err, "Unable to load organisations."),
          errorCode: err instanceof ApiError ? err.payload?.error || null : null,
        };
      } finally {
        if (!passwordValue) {
          organisationLookupInFlightRef.current.delete(cacheKey);
        }
      }
    })();

    if (!passwordValue) {
      organisationLookupInFlightRef.current.set(cacheKey, lookupPromise);
    }

    return lookupPromise;
  }, []);

  const login = useCallback(async (form) => {
    setError(null);
    try {
      const payload = buildLoginPayload(form || {});
      await apiFetch("/api/eip/auth/login/password", {
        method: "POST",
        body: payload,
      });
      const refreshed = await refresh({ silent: true });
      if (!refreshed.ok) {
        return {
          ok: false,
          error: "Login succeeded but session refresh failed.",
        };
      }
      return { ok: true };
    } catch (err) {
      const message = describeApiError(err, "Login failed.");
      setError(message);
      return {
        ok: false,
        error: message,
        errorCode: err instanceof ApiError ? err.payload?.error || null : null,
      };
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await apiFetch("/api/eip/auth/logout", {
        method: "POST",
      });
    } catch (err) {
      const message = describeApiError(err, "Logout failed.");
      setError(message);
    } finally {
      setSession(null);
      organisationLookupCacheRef.current.clear();
      organisationLookupInFlightRef.current.clear();
    }
  }, []);

  const requestOtp = useCallback(async (form) => {
    setError(null);
    try {
      const payload = buildLoginPayload(form || {});
      const response = await apiFetch("/api/eip/auth/request-otp", {
        method: "POST",
        body: payload,
      });
      return {
        ok: true,
        challengeId: response?.challenge_id || null,
        expiresAt: response?.expires_at || null,
      };
    } catch (err) {
      const message = describeApiError(err, "Unable to request OTP.");
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  const loginWithOtp = useCallback(async ({ form, challengeId, otpCode }) => {
    setError(null);
    try {
      const payload = {
        ...buildLoginPayload(form || {}),
        challengeId: String(challengeId || "").trim(),
        otp: String(otpCode || "").trim(),
      };
      await apiFetch("/api/eip/auth/login/otp", {
        method: "POST",
        body: payload,
      });
      const refreshed = await refresh({ silent: true });
      if (!refreshed.ok) {
        return { ok: false, error: "OTP login succeeded but session refresh failed." };
      }
      return { ok: true };
    } catch (err) {
      const message = describeApiError(err, "OTP verification failed.");
      setError(message);
      return { ok: false, error: message };
    }
  }, [refresh]);

  const loginWithTotp = useCallback(async (form) => {
    setError(null);
    try {
      const payload = {
        ...buildLoginPayload(form || {}),
        token: String(form?.totpCode || "").trim(),
      };
      await apiFetch("/api/eip/auth/login/totp", {
        method: "POST",
        body: payload,
      });
      const refreshed = await refresh({ silent: true });
      if (!refreshed.ok) {
        return { ok: false, error: "TOTP login succeeded but session refresh failed." };
      }
      return { ok: true };
    } catch (err) {
      const message = describeApiError(err, "TOTP verification failed.");
      setError(message);
      return { ok: false, error: message };
    }
  }, [refresh]);

  const bootstrapTotp = useCallback(async (form) => {
    setError(null);
    try {
      const payload = buildLoginPayload(form || {});
      const response = await apiFetch("/api/eip/auth/totp/bootstrap", {
        method: "POST",
        body: payload,
      });
      return {
        ok: true,
        uri: response?.uri || null,
        secretPreview: response?.secret_preview || null,
      };
    } catch (err) {
      const message = describeApiError(err, "Unable to start TOTP setup.");
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  const requestAccess = useCallback(async (requestForm) => {
    setError(null);
    try {
      const payload = {
        applicantType: String(requestForm?.applicantType || "").trim(),
        legalName: String(requestForm?.legalName || "").trim(),
        businessRegNo: String(requestForm?.businessRegNo || "").trim(),
        personalIdNo: String(requestForm?.personalIdNo || "").trim(),
        email: String(requestForm?.email || "").trim(),
        phone: String(requestForm?.phone || "").trim(),
        country: String(requestForm?.country || "").trim(),
        timezone: String(requestForm?.timezone || "").trim(),
        acceptTerms: requestForm?.acceptTerms === true,
        acceptPrivacy: requestForm?.acceptPrivacy === true,
      };
      const response = await apiFetch("/api/public/tenant-requests", {
        method: "POST",
        body: payload,
      });
      return {
        ok: true,
        ref: response?.ref || null,
        delivery: response?.delivery || null,
      };
    } catch (err) {
      const message = describeApiError(err, "Unable to submit access request.");
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  useEffect(() => {
    const configuredMinutes = Number(import.meta.env.VITE_IDLE_TIMEOUT_MIN || "0");
    const idleMinutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0
      ? configuredMinutes
      : 30;

    if (!session) {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
      return undefined;
    }

    const idleTimeoutMs = idleMinutes * 60 * 1000;
    const resetIdleTimer = () => {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
      idleTimeoutRef.current = setTimeout(() => {
        setError("Session ended due to inactivity. Please sign in again.");
        logout();
      }, idleTimeoutMs);
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    resetIdleTimer();
    for (const eventName of events) {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    }

    return () => {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
      for (const eventName of events) {
        window.removeEventListener(eventName, resetIdleTimer);
      }
    };
  }, [logout, session]);

  const value = useMemo(() => ({
    session,
    loading,
    error,
    authenticated: Boolean(session),
    refresh,
    resolveOrganisations,
    login,
    requestOtp,
    loginWithOtp,
    loginWithTotp,
    bootstrapTotp,
    requestAccess,
    logout,
  }), [
    session,
    loading,
    error,
    refresh,
    resolveOrganisations,
    login,
    requestOtp,
    loginWithOtp,
    loginWithTotp,
    bootstrapTotp,
    requestAccess,
    logout,
  ]);

  return value;
}

export { buildLoginPayload, useAuthSession };
