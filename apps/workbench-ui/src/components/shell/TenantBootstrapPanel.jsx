import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";

function TenantBootstrapPanel({ token, onReturnToLogin }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const passwordMatch = useMemo(
    () => Boolean(password && confirmPassword && password === confirmPassword),
    [confirmPassword, password]
  );

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!passwordMatch) {
      setError("Passwords must match.");
      return;
    }

    setLoading(true);
    try {
      const payload = await apiFetch("/api/public/tenant-bootstrap/complete", {
        method: "POST",
        body: { token, password },
      });
      setResult(payload || null);
    } catch (err) {
      const feedback = Array.isArray(err?.payload?.feedback) ? err.payload.feedback.join(" ") : "";
      setError(feedback || describeApiError(err, "Unable to activate the organisation."));
    } finally {
      setLoading(false);
    }
  }

  if (result?.ok) {
    return (
      <section className="login-shell tenant-bootstrap-shell">
        <div className="card login-card tenant-bootstrap-card">
          <div className="tenant-bootstrap-mark tenant-bootstrap-mark--success">
            <CheckCircle2 size={30} />
          </div>
          <p className="eyebrow">Organisation activated</p>
          <h1>Setup complete</h1>
          <p className="muted">Your EIP organisation is ready. Use the details below to sign in.</p>
          <dl className="tenant-bootstrap-summary">
            <div><dt>Organisation</dt><dd>{result.tenant_name || "-"}</dd></div>
            <div><dt>Organisation code</dt><dd>{result.tenant_code || "-"}</dd></div>
            <div><dt>Login</dt><dd>{result.login || "-"}</dd></div>
          </dl>
          <button type="button" className="primary-button" onClick={onReturnToLogin}>
            Continue to sign in
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="login-shell tenant-bootstrap-shell">
      <form className="card login-card tenant-bootstrap-card" onSubmit={submit}>
        <div className="tenant-bootstrap-mark">
          <ShieldCheck size={28} />
        </div>
        <p className="eyebrow">Secure organisation setup</p>
        <h1>Activate your EIP access</h1>
        <p className="muted">Create the first administrator password for the approved organisation.</p>

        <label className="tenant-bootstrap-field">
          <span>Password</span>
          <div className="tenant-bootstrap-input-wrap">
            <KeyRound size={16} />
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
              required
            />
          </div>
        </label>

        <label className="tenant-bootstrap-field">
          <span>Confirm password</span>
          <div className="tenant-bootstrap-input-wrap">
            <KeyRound size={16} />
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat password"
              required
            />
          </div>
        </label>

        <p className="tenant-bootstrap-help">
          Use uppercase, lowercase, a number and a symbol. Avoid common passwords.
        </p>
        {error ? <div className="tenant-bootstrap-error">{error}</div> : null}

        <button type="submit" className="primary-button" disabled={loading || !passwordMatch}>
          {loading ? "Activating..." : "Activate organisation"}
        </button>
        <button type="button" className="ghost-button" onClick={onReturnToLogin} disabled={loading}>
          Back to sign in
        </button>
      </form>
    </section>
  );
}

export default TenantBootstrapPanel;
