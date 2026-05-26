/**
 * Webmail HTTP endpoints.
 *
 *   GET  /mail/webmail/targets?serverId=…   — host picker options
 *   POST /mail/webmail/deploy-project       — create project + deployment
 *
 * Self-hosted only (the parent /mail mount applies localOnly + auth).
 */

import type { Context } from "hono";
import { env } from "../../../config";
import { getUserId } from "../../../lib/controller-helpers";
import { listWebmailTargets } from "./webmail.service";
import { startWebmailDeploy } from "./webmail-project.service";

const HOSTNAME_RE = /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/;

// ─── GET /mail/webmail/targets ───────────────────────────────────────────────

export async function getTargetsHandler(c: Context) {
  if (env.CLOUD_MODE) return c.json({ error: "Not available" }, 404);

  const mailServerId = c.req.query("serverId");
  if (!mailServerId) {
    return c.json({ error: "serverId is required" }, 400);
  }
  const options = await listWebmailTargets(mailServerId);
  return c.json({ options });
}

// ─── POST /mail/webmail/deploy-project ───────────────────────────────────────

/**
 * Body: { mailServerId, targetServerId, hostname, internalPort? }
 *
 * Creates (or reuses) the webmail project + a queued deployment + a build
 * session, then kicks off the engine in the background. Returns the IDs so
 * the dashboard can redirect to /build/[deploymentId] and subscribe to the
 * standard SSE endpoint.
 */
export async function startDeployAsProjectHandler(c: Context) {
  if (env.CLOUD_MODE) return c.json({ error: "Not available" }, 404);

  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const mailServerId = body.mailServerId as string | undefined;
  const targetServerId = body.targetServerId as string | undefined;
  const hostname = (body.hostname as string | undefined)?.trim().toLowerCase();
  const internalPort =
    typeof body.internalPort === "number" ? body.internalPort : undefined;

  if (!mailServerId) return c.json({ error: "mailServerId is required" }, 400);
  if (!targetServerId)
    return c.json({ error: "targetServerId is required" }, 400);
  if (!hostname || !HOSTNAME_RE.test(hostname))
    return c.json({ error: "Invalid domain" }, 400);

  try {
    const { deploymentId, projectId } = await startWebmailDeploy({
      userId,
      mailServerId,
      targetServerId,
      hostname,
      internalPort,
    });
    return c.json({ deploymentId, projectId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start deploy";
    return c.json({ error: message }, 500);
  }
}
