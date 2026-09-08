import crypto from "node:crypto";
import { rotateSecret } from "./connectionSecretStore.js";

const API_KEY_PREFIX = "eip_";

function generateApiKeyValue() {
  return `${API_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

async function generateConnectionApiKey({
  client,
  tenantId,
  connectionCode,
  actorIdentityId,
  config,
}) {
  const value = generateApiKeyValue();
  const secret = await rotateSecret({
    client,
    tenantId,
    connectionCode,
    secretKind: "api_key",
    plaintext: value,
    actorIdentityId,
    config,
  });

  return {
    value,
    secret,
  };
}

export { API_KEY_PREFIX, generateApiKeyValue, generateConnectionApiKey };
