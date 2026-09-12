import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import TenantBootstrapPanel from "./components/shell/TenantBootstrapPanel.jsx";
import "./styles.css";
import "./ownerAdminCompletion.css";
import "./ownerAdminCascadeFix.css";

function readBootstrapToken() {
  const params = new URLSearchParams(window.location.search);
  const token = String(params.get("bootstrap_token") || "").trim();
  return token || null;
}

function RootRouter() {
  const [bootstrapToken, setBootstrapToken] = useState(readBootstrapToken);

  function returnToLogin() {
    const url = new URL(window.location.href);
    url.searchParams.delete("bootstrap_token");
    window.history.replaceState({}, "", url);
    setBootstrapToken(null);
  }

  if (bootstrapToken) {
    return <TenantBootstrapPanel token={bootstrapToken} onReturnToLogin={returnToLogin} />;
  }

  return <App />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RootRouter />
  </StrictMode>
);
