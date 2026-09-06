const AUTH_REALM = "EIP";

function sendFailure(reply, result) {
  return reply.code(result.status || 400).send({
    ok: false,
    error: result.error || "BAD_REQUEST",
  });
}

export default async function authSessionTransportRoutes(app) {
  app.get("/auth/csrf", async (request, reply) => {
    const sessionResult = await app.requireSession(request, { realm: AUTH_REALM });
    if (!sessionResult.ok) {
      return sendFailure(reply, sessionResult);
    }

    const csrfResult = await app.readCsrfTokenForSession(request);
    if (!csrfResult.ok) {
      return sendFailure(reply, csrfResult);
    }

    reply.header("Cache-Control", "no-store, max-age=0");
    reply.header("Pragma", "no-cache");
    return reply.send({ ok: true, csrf: csrfResult.csrf });
  });
}
