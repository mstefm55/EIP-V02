import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Building2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import eipMark from "../../assets/branding/eip-modern-favicon.png";

const DEFAULT_FORM = {
  tenantId: "",
  tenantCode: "",
  login: "",
  identityLogin: "",
  password: "",
  totpCode: "",
};

const DEFAULT_REQUEST_FORM = {
  applicantType: "business",
  legalName: "",
  businessRegNo: "",
  personalIdNo: "",
  email: "",
  phone: "",
  country: "",
  timezone: "",
  acceptTerms: false,
  acceptPrivacy: false,
};

function extractTotpSecret(uriValue) {
  const uri = String(uriValue || "").trim();
  if (!uri) return "";
  try {
    return new URL(uri).searchParams.get("secret") || "";
  } catch {
    return "";
  }
}

function organisationValue(organisation) {
  return String(organisation?.code || organisation?.id || "").trim();
}

function organisationLabel(organisation) {
  const name = String(organisation?.name || "").trim();
  const code = String(organisation?.code || organisation?.id || "").trim();
  return name && code && name !== code ? `${name} (${code})` : name || code;
}

function LoginPanel({
  onResolveOrganisations,
  onLogin,
  onRequestOtp,
  onLoginWithOtp,
  onLoginWithTotp,
  onBootstrapTotp,
  onRequestAccess,
  loading,
  error,
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [localNotice, setLocalNotice] = useState(null);
  const [activeModal, setActiveModal] = useState(null); // otp | requestAccess | totp | null
  const [challengeId, setChallengeId] = useState(null);
  const [challengeExpiresAt, setChallengeExpiresAt] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [organisations, setOrganisations] = useState([]);
  const [organisationStatus, setOrganisationStatus] = useState(null);
  const [organisationLoading, setOrganisationLoading] = useState(false);
  const [totpSetup, setTotpSetup] = useState({
    uri: "",
    secret: "",
    secretPreview: "",
  });
  const [totpQrDataUrl, setTotpQrDataUrl] = useState("");
  const [requestForm, setRequestForm] = useState(DEFAULT_REQUEST_FORM);
  const [requestNotice, setRequestNotice] = useState(null);
  const loginInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const busy = loading || submitting || organisationLoading;

  const assuranceItems = useMemo(() => ([
    {
      title: "Session assurance",
      description: "Verified sign-ins maintain a secure and consistent session.",
    },
    {
      title: "Cross-site verification",
      description: "Verification checks are enforced across connected access points.",
    },
    {
      title: "Device trust",
      description: "Recognized devices improve sign-in continuity while preserving control.",
    },
  ]), []);

  const securityStandards = useMemo(() => ([
    "Sophisticated security controls are applied to every sign-in.",
    "Your session is protected using secure cookies.",
    "Sensitive actions require an additional verification step.",
  ]), []);

  const headerLinks = useMemo(() => ([
    { label: "Platform", href: "/api/public/health" },
    { label: "Security", href: "/api/public/health" },
    { label: "Docs", href: "/api/public/health" },
    { label: "Status", href: "/api/public/health" },
  ]), []);

  useEffect(() => {
    let active = true;
    if (!totpSetup.uri) {
      setTotpQrDataUrl("");
      return undefined;
    }

    QRCode.toDataURL(totpSetup.uri, {
      margin: 1,
      width: 220,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (active) setTotpQrDataUrl(url);
      })
      .catch(() => {
        if (active) setTotpQrDataUrl("");
      });

    return () => {
      active = false;
    };
  }, [totpSetup.uri]);

  function applyOrganisation(organisation) {
    if (!organisation) return;
    const id = String(organisation.id || "").trim();
    const code = String(organisation.code || "").trim();
    const identityLogin = String(organisation.identity_login || organisation.login || "").trim();
    setForm((prev) => ({
      ...prev,
      tenantId: id,
      tenantCode: code || id,
      identityLogin: identityLogin || prev.login,
    }));
  }

  async function resolveOrganisations() {
    const login = String(form.login || "").trim();
    if (!login) {
      setOrganisations([]);
      setOrganisationStatus("Enter your email to load organisations.");
      return [];
    }
    if (typeof onResolveOrganisations !== "function") {
      setOrganisationStatus("Organisation lookup is unavailable.");
      return [];
    }

    setOrganisationLoading(true);
    setLocalError(null);
    try {
      const result = await onResolveOrganisations({
        login,
        password: String(form.password || ""),
      });
      if (!result?.ok) {
        setOrganisations([]);
        setForm((prev) => ({ ...prev, tenantId: "", tenantCode: "", identityLogin: "" }));
        setOrganisationStatus(result?.error || "Unable to load organisations.");
        return [];
      }

      const list = Array.isArray(result.organisations) ? result.organisations : [];
      setOrganisations(list);
      if (!list.length) {
        setForm((prev) => ({ ...prev, tenantId: "", tenantCode: "", identityLogin: "" }));
        setOrganisationStatus("No organisations found for this account.");
        return [];
      }

      const currentTenant = String(form.tenantCode || form.tenantId || "").trim().toLowerCase();
      const selected = list.find((organisation) => {
        const code = String(organisation.code || "").trim().toLowerCase();
        const id = String(organisation.id || "").trim().toLowerCase();
        return currentTenant && (currentTenant === code || currentTenant === id);
      }) || list[0];
      applyOrganisation(selected);
      setOrganisationStatus(`Found ${list.length} organisation${list.length === 1 ? "" : "s"}.`);
      return list;
    } finally {
      setOrganisationLoading(false);
    }
  }

  function handleOrganisationChange(value) {
    const cleanValue = String(value || "").trim();
    const selected = organisations.find((organisation) => {
      const code = String(organisation.code || "").trim();
      const id = String(organisation.id || "").trim();
      return cleanValue === code || cleanValue === id;
    });
    if (selected) {
      applyOrganisation(selected);
      return;
    }
    setForm((prev) => ({
      ...prev,
      tenantId: "",
      tenantCode: cleanValue,
      identityLogin: "",
    }));
  }

  function setDemoAccess() {
    setForm(DEFAULT_FORM);
    setOrganisations([]);
    setOrganisationStatus(null);
    setLocalNotice("Enter your email to load your organisations, then authenticate.");
    setLocalError(null);
    requestAnimationFrame(() => loginInputRef.current?.focus());
  }

  function openQuickAccess() {
    setDemoAccess();
  }

  function openRequestAccess() {
    setRequestNotice(null);
    setLocalError(null);
    setActiveModal("requestAccess");
  }

  function closeModal() {
    setActiveModal(null);
  }

  async function submit(event) {
    event.preventDefault();
    setLocalError(null);
    setLocalNotice(null);
    setSubmitting(true);
    try {
      const result = await onLogin?.(form);
      if (!result?.ok) {
        if (result?.errorCode === "TOTP_REQUIRED" || result?.errorCode === "TOTP_ENROLL_REQUIRED") {
          setActiveModal("totp");
          setLocalNotice(
            result?.errorCode === "TOTP_ENROLL_REQUIRED"
              ? "Password verified. Set up your authenticator app to continue."
              : "Password verified. Enter your authenticator code to complete sign-in."
          );
          return;
        }
        setLocalError(result?.error || "Login failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function requestOtp() {
    setLocalError(null);
    setLocalNotice(null);
    setSubmitting(true);
    try {
      const result = await onRequestOtp?.(form);
      if (!result?.ok) {
        setLocalError(result?.error || "Unable to request OTP.");
        return;
      }
      setChallengeId(result?.challengeId || null);
      setChallengeExpiresAt(result?.expiresAt || null);
      setActiveModal("otp");
      setLocalNotice("OTP sent to your registered email.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyOtp() {
    setLocalError(null);
    if (!challengeId) {
      setLocalError("Request OTP first, then verify the code.");
      return;
    }
    const otpCode = String(form.totpCode || "").trim();
    if (!otpCode) {
      setLocalError("Enter the OTP code before verification.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await onLoginWithOtp?.({
        form,
        challengeId,
        otpCode,
      });
      if (!result?.ok) {
        setLocalError(result?.error || "OTP verification failed.");
        return;
      }
      closeModal();
      setLocalNotice("OTP verified. You are now signed in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyTotp() {
    setLocalError(null);
    setSubmitting(true);
    try {
      const result = await onLoginWithTotp?.(form);
      if (!result?.ok) {
        setLocalError(result?.error || "TOTP verification failed.");
        return;
      }
      closeModal();
      setLocalNotice("TOTP verified. You are now signed in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function setupTotp() {
    setLocalError(null);
    setSubmitting(true);
    try {
      const result = await onBootstrapTotp?.(form);
      if (!result?.ok) {
        setLocalError(result?.error || "Unable to set up TOTP.");
        return;
      }
      const uri = String(result?.uri || "");
      setTotpSetup({
        uri,
        secret: extractTotpSecret(uri),
        secretPreview: String(result?.secretPreview || ""),
      });
      setActiveModal("totp");
      setLocalNotice("Scan the QR code in your authenticator app, then verify the code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRequestAccess(event) {
    event.preventDefault();
    setRequestNotice(null);
    setLocalError(null);
    if (!onRequestAccess) {
      setLocalError("Access request service is unavailable.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await onRequestAccess(requestForm);
      if (!result?.ok) {
        setLocalError(result?.error || "Unable to submit access request.");
        return;
      }
      setRequestNotice(`Request submitted successfully${result?.ref ? ` (${result.ref})` : ""}.`);
      setRequestForm(DEFAULT_REQUEST_FORM);
    } finally {
      setSubmitting(false);
    }
  }

  function openForgot(event) {
    event.preventDefault();
    const tenantCode = encodeURIComponent(String(form.tenantCode || "").trim());
    const loginValue = encodeURIComponent(String(form.login || "").trim());
    window.location.href = `mailto:access@eipcore.local?subject=EIP%20Password%20Reset&body=Organisation:%20${tenantCode}%0ALogin:%20${loginValue}`;
  }

  function openRecovery(event) {
    event.preventDefault();
    const tenantCode = encodeURIComponent(String(form.tenantCode || "").trim());
    const loginValue = encodeURIComponent(String(form.login || "").trim());
    window.location.href = `mailto:access@eipcore.local?subject=EIP%20Recovery%20Access&body=Organisation:%20${tenantCode}%0ALogin:%20${loginValue}`;
  }

  async function copyValue(value, label) {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setLocalNotice(`${label} copied.`);
    } catch {
      setLocalNotice(`Unable to copy ${label.toLowerCase()} automatically.`);
    }
  }

  const challengeLabel = challengeExpiresAt
    ? `Code expires at ${new Date(challengeExpiresAt).toLocaleTimeString()}.`
    : null;
  const otpEmail = String(form.login || "").trim();
  const otpTenantCode = String(form.tenantCode || form.tenantId || "").trim();
  const selectedOtpOrganisation = organisations.find((organisation) => {
    const value = organisationValue(organisation);
    return value === otpTenantCode || String(organisation.id || "").trim() === otpTenantCode;
  });
  const otpTenantLabel = selectedOtpOrganisation
    ? organisationLabel(selectedOtpOrganisation)
    : otpTenantCode || "Select organisation";

  return (
    <section className="authv1-shell">
      <div className="authv1-aurora" />
      <div className="authv1-grain" />

      <header className="authv1-header">
        <div className="authv1-brand">
          <span className="authv1-brand-mark">
            <img src={eipMark} alt="EIP" />
          </span>
          <div>
            <p className="authv1-brand-top">EIP Core</p>
            <p className="authv1-brand-bottom">Identity Gateway</p>
          </div>
        </div>
        <nav className="authv1-header-nav" aria-label="Additional resources">
          {headerLinks.map((item) => (
            <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="authv1-header-actions">
          <button type="button" className="authv1-header-pill authv1-header-pill-ghost" onClick={openQuickAccess}>
            Quick Access
          </button>
          <button type="button" className="authv1-header-pill authv1-header-pill-solid" onClick={openRequestAccess}>
            <UserPlus size={14} strokeWidth={2} />
            Request Access
          </button>
        </div>
      </header>

      <main className="authv1-main">
        <section className="authv1-left">
          <div className="authv1-left-stack">
            <div className="authv1-panel authv1-hero">
              <p className="authv1-eyebrow">Identity Gateway</p>
              <h1>Secure access to every workspace.</h1>
              <p>
                Secure access to your workspace. Enter your email, select your organisation, and
                authenticate with OTP or password-only trusted-device sign-in.
              </p>
            </div>

            <div className="authv1-assurance-grid">
              {assuranceItems.map((item) => (
                <article key={item.title} className="authv1-panel authv1-assurance-card">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>

            <div className="authv1-panel authv1-standards">
              <h3>Security standards</h3>
              <ul>
                {securityStandards.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="authv1-right">
          <form className="authv1-panel authv1-login-card" onSubmit={submit}>
            <p className="authv1-card-title">Welcome back</p>
            <p className="authv1-card-subtitle">Sign in to your organisation account.</p>

            <label className="authv1-field">
              <span>Email</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <Mail size={17} strokeWidth={1.9} />
                </span>
                <input
                  ref={loginInputRef}
                  aria-label="Login"
                  value={form.login}
                  onChange={(event) => {
                    const login = event.target.value;
                    setForm((prev) => ({
                      ...prev,
                      login,
                      identityLogin: "",
                      tenantId: "",
                      tenantCode: "",
                    }));
                    setOrganisations([]);
                    setOrganisationStatus(null);
                    setChallengeId(null);
                  }}
                  onBlur={() => {
                    if (String(form.login || "").trim()) void resolveOrganisations();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void resolveOrganisations();
                    }
                  }}
                  placeholder="ops@organisation.com"
                  autoComplete="username"
                  required
                />
              </div>
            </label>

            <label className="authv1-field">
              <span>Organisation</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <Building2 size={17} strokeWidth={1.9} />
                </span>
                {organisations.length ? (
                  <select
                    aria-label="Tenant Code"
                    value={otpTenantCode}
                    onChange={(event) => handleOrganisationChange(event.target.value)}
                  >
                    {organisations.map((organisation) => {
                      const value = organisationValue(organisation);
                      return (
                        <option key={String(organisation.id || value)} value={value}>
                          {organisationLabel(organisation)}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <input
                    aria-label="Tenant Code"
                    value={form.tenantCode}
                    onChange={(event) => handleOrganisationChange(event.target.value)}
                    placeholder="Enter org name or code"
                    required
                  />
                )}
              </div>
              {organisationStatus ? (
                <p className="authv1-otp-delivery-note">{organisationStatus}</p>
              ) : null}
            </label>

            <label className="authv1-field">
              <span>Password</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <Lock size={17} strokeWidth={1.9} />
                </span>
                <input
                  ref={passwordInputRef}
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, password: event.target.value }))
                  }
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="authv1-input-toggle"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <EyeOff size={17} strokeWidth={1.9} /> : <Eye size={17} strokeWidth={1.9} />}
                </button>
              </div>
            </label>

            <label className="authv1-field">
              <span>OTP / TOTP Code</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <KeyRound size={17} strokeWidth={1.9} />
                </span>
                <input
                  aria-label="TOTP Code"
                  value={form.totpCode}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, totpCode: event.target.value }))
                  }
                  placeholder="123 456"
                />
              </div>
            </label>

            {error || localError ? (
              <div className="state-notice error">
                <strong>Authentication error</strong>
                <p>{localError || error}</p>
              </div>
            ) : null}
            {!error && !localError && localNotice ? (
              <div className="state-notice warning">
                <strong>Access note</strong>
                <p>{localNotice}</p>
              </div>
            ) : null}
            {challengeId ? (
              <div className="state-notice">
                <strong>OTP sent</strong>
                <p>{challengeLabel || "Check your email and enter the one-time code."}</p>
              </div>
            ) : null}

            <button type="button" className="authv1-primary" onClick={requestOtp} disabled={busy}>
              Request OTP
            </button>

            <button
              type="submit"
              className="authv1-secondary authv1-submit"
              aria-label="Sign In"
              disabled={busy}
            >
              {busy ? "Signing in..." : "Use password-only (trusted device)"}
            </button>
            <button type="button" className="authv1-secondary" onClick={verifyTotp} disabled={busy}>
              Verify TOTP
            </button>
            <button type="button" className="authv1-secondary" onClick={setupTotp} disabled={busy}>
              Set up TOTP
            </button>

            <div className="authv1-login-links">
              <p>For your security, additional verification may be required.</p>
              <button type="button" className="authv1-link-button" onClick={openForgot}>
                Forgot password?
              </button>
              <button type="button" className="authv1-link-button" onClick={openRecovery}>
                Recovery access
              </button>
            </div>
          </form>
        </section>
      </main>

      {activeModal === "otp" ? (
        <div className="authv1-modal-backdrop" role="dialog" aria-modal="true" aria-label="Quick access OTP">
          <div className="authv1-modal-card authv1-modal-card--otp">
            <div className="authv1-modal-header">
              <div>
                <h3>Verify access</h3>
              </div>
              <button type="button" className="authv1-modal-close" aria-label="Close OTP panel" onClick={closeModal}>
                &times;
              </button>
            </div>
            <p className="authv1-modal-text">
              Enter the OTP sent to your email. Use organisation code if you belong to multiple workspaces.
            </p>
            <label className="authv1-field">
              <span>Email</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <Mail size={17} strokeWidth={1.9} />
                </span>
                <input aria-label="OTP email" value={otpEmail} readOnly />
              </div>
            </label>
            <label className="authv1-field">
              <span>Organisation</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <Building2 size={17} strokeWidth={1.9} />
                </span>
                <select
                  className="authv1-otp-tenant-select"
                  aria-label="Organisation"
                  value={otpTenantCode}
                  onChange={(event) => handleOrganisationChange(event.target.value)}
                >
                  {organisations.length ? organisations.map((organisation) => {
                    const value = organisationValue(organisation);
                    return (
                      <option key={String(organisation.id || value)} value={value}>
                        {organisationLabel(organisation)}
                      </option>
                    );
                  }) : (
                    <option value={otpTenantCode}>{otpTenantLabel}</option>
                  )}
                </select>
              </div>
            </label>
            <label className="authv1-field">
              <span>One-time code</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <KeyRound size={17} strokeWidth={1.9} />
                </span>
                <input
                  aria-label="OTP code"
                  value={form.totpCode}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, totpCode: event.target.value }))
                  }
                  placeholder="123 456"
                />
              </div>
            </label>
            <div className="authv1-modal-actions">
              <button type="button" className="authv1-primary" onClick={verifyOtp} disabled={busy}>
                Verify OTP
              </button>
            </div>
            {challengeId ? (
              <p className="authv1-otp-delivery-note">{challengeLabel || "OTP sent. Check your email."}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeModal === "requestAccess" ? (
        <div className="authv1-modal-backdrop" role="dialog" aria-modal="true" aria-label="Request access">
          <div className="authv1-modal-card authv1-modal-card--wide">
            <div className="authv1-modal-header">
              <div>
                <p className="authv1-eyebrow">Request Access</p>
                <h3>Submit your onboarding request</h3>
              </div>
              <button type="button" className="authv1-modal-close" aria-label="Close access request panel" onClick={closeModal}>
                x
              </button>
            </div>
            <form className="authv1-modal-grid" onSubmit={submitRequestAccess}>
              <label className="authv1-field">
                <span>Applicant Type</span>
                <div className="authv1-input-shell">
                  <span className="authv1-input-icon" aria-hidden="true">
                    <Building2 size={17} strokeWidth={1.9} />
                  </span>
                  <select
                    value={requestForm.applicantType}
                    onChange={(event) =>
                      setRequestForm((prev) => ({ ...prev, applicantType: event.target.value }))
                    }
                  >
                    <option value="business">Business</option>
                    <option value="sole_trader">Sole trader</option>
                  </select>
                </div>
              </label>
              <label className="authv1-field">
                <span>Legal Name</span>
                <div className="authv1-input-shell">
                  <span className="authv1-input-icon" aria-hidden="true">
                    <Mail size={17} strokeWidth={1.9} />
                  </span>
                  <input
                    value={requestForm.legalName}
                    onChange={(event) =>
                      setRequestForm((prev) => ({ ...prev, legalName: event.target.value }))
                    }
                    placeholder="Organisation legal name"
                    required
                  />
                </div>
              </label>
              {requestForm.applicantType === "business" ? (
                <label className="authv1-field">
                  <span>Business Reg Number</span>
                  <div className="authv1-input-shell">
                    <span className="authv1-input-icon" aria-hidden="true">
                      <ShieldCheck size={17} strokeWidth={1.9} />
                    </span>
                    <input
                      value={requestForm.businessRegNo}
                      onChange={(event) =>
                        setRequestForm((prev) => ({ ...prev, businessRegNo: event.target.value }))
                      }
                      placeholder="Registration number"
                      required
                    />
                  </div>
                </label>
              ) : (
                <label className="authv1-field">
                  <span>Personal ID Number</span>
                  <div className="authv1-input-shell">
                    <span className="authv1-input-icon" aria-hidden="true">
                      <ShieldCheck size={17} strokeWidth={1.9} />
                    </span>
                    <input
                      value={requestForm.personalIdNo}
                      onChange={(event) =>
                        setRequestForm((prev) => ({ ...prev, personalIdNo: event.target.value }))
                      }
                      placeholder="ID number"
                      required
                    />
                  </div>
                </label>
              )}
              <label className="authv1-field">
                <span>Email</span>
                <div className="authv1-input-shell">
                  <span className="authv1-input-icon" aria-hidden="true">
                    <Mail size={17} strokeWidth={1.9} />
                  </span>
                  <input
                    type="email"
                    value={requestForm.email}
                    onChange={(event) =>
                      setRequestForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                    placeholder="contact@organisation.com"
                    required
                  />
                </div>
              </label>
              <label className="authv1-field">
                <span>Phone</span>
                <div className="authv1-input-shell">
                  <span className="authv1-input-icon" aria-hidden="true">
                    <Mail size={17} strokeWidth={1.9} />
                  </span>
                  <input
                    value={requestForm.phone}
                    onChange={(event) =>
                      setRequestForm((prev) => ({ ...prev, phone: event.target.value }))
                    }
                    placeholder="+230 5xxx xxxx"
                  />
                </div>
              </label>
              <label className="authv1-field">
                <span>Country</span>
                <div className="authv1-input-shell">
                  <span className="authv1-input-icon" aria-hidden="true">
                    <Building2 size={17} strokeWidth={1.9} />
                  </span>
                  <input
                    value={requestForm.country}
                    onChange={(event) =>
                      setRequestForm((prev) => ({ ...prev, country: event.target.value }))
                    }
                    placeholder="Mauritius"
                    required
                  />
                </div>
              </label>
              <label className="authv1-field">
                <span>Timezone</span>
                <div className="authv1-input-shell">
                  <span className="authv1-input-icon" aria-hidden="true">
                    <Building2 size={17} strokeWidth={1.9} />
                  </span>
                  <input
                    value={requestForm.timezone}
                    onChange={(event) =>
                      setRequestForm((prev) => ({ ...prev, timezone: event.target.value }))
                    }
                    placeholder="Indian/Mauritius"
                    required
                  />
                </div>
              </label>
              <div className="authv1-terms-card">
                <p className="authv1-eyebrow">Terms & Conditions</p>
                <p>
                  By submitting this request, you confirm the provided details are accurate, agree to
                  EIP access governance and security controls, and acknowledge onboarding is subject to
                  review and approval.
                </p>
              </div>
              <label className="authv1-checkbox">
                <input
                  type="checkbox"
                  checked={requestForm.acceptTerms}
                  onChange={(event) =>
                    setRequestForm((prev) => ({ ...prev, acceptTerms: event.target.checked }))
                  }
                  required
                />
                <Check size={14} strokeWidth={2.3} />
                <span>I have read and accept the access terms.</span>
              </label>
              <label className="authv1-checkbox">
                <input
                  type="checkbox"
                  checked={requestForm.acceptPrivacy}
                  onChange={(event) =>
                    setRequestForm((prev) => ({ ...prev, acceptPrivacy: event.target.checked }))
                  }
                  required
                />
                <Check size={14} strokeWidth={2.3} />
                <span>I consent to privacy and security processing.</span>
              </label>
              {requestNotice ? (
                <div className="state-notice warning">
                  <strong>Request received</strong>
                  <p>{requestNotice}</p>
                </div>
              ) : null}
              <div className="authv1-modal-inline-actions">
                <button type="submit" className="authv1-primary" disabled={busy}>
                  Submit Request
                </button>
                <button type="button" className="authv1-secondary" onClick={closeModal}>
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeModal === "totp" ? (
        <div className="authv1-modal-backdrop" role="dialog" aria-modal="true" aria-label="TOTP setup and verification">
          <div className="authv1-modal-card authv1-modal-card--wide">
            <div className="authv1-modal-header">
              <div>
                <p className="authv1-eyebrow">Multi-factor verification</p>
                <h3>TOTP setup and sign-in</h3>
              </div>
              <button
                type="button"
                className="authv1-modal-close"
                aria-label="Close TOTP panel"
                onClick={closeModal}
              >
                x
              </button>
            </div>
            <p className="authv1-modal-text">
              Register this account in your authenticator app by scanning the QR code, then verify with a 6-digit code.
            </p>
            <div className="authv1-modal-actions">
              <button type="button" className="authv1-secondary" onClick={setupTotp} disabled={busy}>
                Generate / Refresh Setup Secret
              </button>
            </div>
            <div className="authv1-modal-totp-grid">
              <div className="authv1-modal-qr">
                {totpQrDataUrl ? (
                  <img src={totpQrDataUrl} alt="TOTP QR code" />
                ) : (
                  <p>Generate setup details to display QR code.</p>
                )}
              </div>
              <div className="authv1-modal-secret">
                <strong>Authenticator setup details</strong>
                <p>
                  Secret key: <code>{totpSetup.secret || totpSetup.secretPreview || "Unavailable"}</code>
                </p>
                {totpSetup.uri ? <p className="authv1-modal-uri">{totpSetup.uri}</p> : null}
                <div className="authv1-modal-inline-actions">
                  <button type="button" className="authv1-secondary" onClick={() => copyValue(totpSetup.secret || totpSetup.secretPreview, "Secret key")}>
                    Copy Secret
                  </button>
                  <button type="button" className="authv1-secondary" onClick={() => copyValue(totpSetup.uri, "Setup URI")}>
                    Copy URI
                  </button>
                </div>
              </div>
            </div>
            <label className="authv1-field">
              <span>TOTP Code</span>
              <div className="authv1-input-shell">
                <span className="authv1-input-icon" aria-hidden="true">
                  <KeyRound size={17} strokeWidth={1.9} />
                </span>
                <input
                  aria-label="TOTP modal code"
                  value={form.totpCode}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, totpCode: event.target.value }))
                  }
                  placeholder="123 456"
                />
              </div>
            </label>
            <div className="authv1-modal-inline-actions">
              <button type="button" className="authv1-primary" onClick={verifyTotp} disabled={busy}>
                Verify TOTP
              </button>
              <button type="button" className="authv1-secondary" onClick={closeModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default LoginPanel;
