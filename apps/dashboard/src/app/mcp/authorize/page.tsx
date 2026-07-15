"use client";

/**
 * /mcp/authorize — OAuth 2.1 consent screen for MCP clients.
 *
 * Better Auth's mcp() plugin redirects here (its `consentPage`) mid-authorize
 * with `client_id`, `scope`, and a `consent_code` in the query. We authenticate
 * the browser against the Better Auth cookie session, show what's connecting,
 * and on an explicit Approve POST to `/api/auth/oauth2/consent`
 * (`{ accept, consent_code }`) — which returns a `redirectURI` that continues
 * the flow back to the client.
 *
 * Lives top-level (not under (auth)/(dashboard)) because it's for an
 * AUTHENTICATED visitor; we wrap AuthShell manually for visual parity with
 * /login and /cloud-authorize. Since it's outside the dashboard layout there's
 * no PlatformProvider — the SaaS-vs-self-hosted split for the resource picker
 * comes from the `useDeploymentInfo` hook instead of `usePlatform`.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Boxes, AlertCircle, Lock, Building2, ShieldCheck } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { ResourcePicker } from "@/components/permissions/ResourcePicker";
import { tokensApi, type PickerGrant, type ResourceType } from "@/lib/api";
import { setActiveOrganizationId } from "@/lib/api/client";
import { useDeploymentInfo } from "@/hooks/useDeploymentInfo";

interface Org {
  id: string;
  name: string;
}

/**
 * Better Auth wraps the organization plugin in a Proxy that returns a fresh
 * reference per access, so capture it once at module scope (see AccountSwitcher
 * for the full rationale — using it inline as an effect dep loops forever).
 */
const orgClient = (authClient as unknown as {
  organization: {
    list: () => Promise<{ data?: Org[] }>;
    setActive: (opts: { organizationId: string }) => Promise<{ error?: { message?: string } | null }>;
    getFullOrganization: () => Promise<{ data?: { id: string } | null }>;
  };
}).organization;

function buildReturnTo(searchParams: URLSearchParams): string {
  const qs = searchParams.toString();
  return qs ? `/mcp/authorize?${qs}` : "/mcp/authorize";
}

/** Consent POST → `{ redirectURI }`. Uses the auth client so the cookie session
 *  + auth base URL are handled for us. */
async function postConsent(accept: boolean, consentCode: string | null): Promise<string | null> {
  const res = await (authClient as unknown as {
    $fetch: (
      path: string,
      opts: { method: string; body: Record<string, unknown> },
    ) => Promise<{ data?: { redirectURI?: string } | null; error?: { status?: number } | null }>;
  }).$fetch("/oauth2/consent", {
    method: "POST",
    body: { accept, ...(consentCode ? { consent_code: consentCode } : {}) },
  });
  if (res.error) {
    const status = res.error.status;
    throw Object.assign(new Error("consent failed"), { status });
  }
  return res.data?.redirectURI ?? null;
}

/** Grantable resource types for the current mode. SaaS has no servers/mail
 *  servers; self-hosted has no cloud billing. Mirrors the PAT scope picker. */
function grantableTypes(selfHosted: boolean): ResourceType[] {
  return selfHosted
    ? ["project", "server", "mail_server", "backup_destination", "audit", "github_installation", "github_repository"]
    : ["project", "backup_destination", "billing", "audit", "github_installation", "github_repository"];
}

function McpAuthorizeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();

  const clientId = searchParams.get("client_id");
  const consentCode = searchParams.get("consent_code");

  const [submitting, setSubmitting] = useState<null | "accept" | "deny">(null);
  const [error, setError] = useState<string | null>(null);

  const [readOnly, setReadOnly] = useState(false);
  const [grants, setGrants] = useState<PickerGrant[]>([]);
  // Explicit access mode so what's granted is obvious. full = act with the
  // user's own role (no resource grants); limited = scope to the picked
  // resources. Default to full — the common case for your own client.
  const [mode, setMode] = useState<"full" | "limited">("full");

  const selfHosted = useDeploymentInfo()?.selfHosted ?? true;

  // The org the client will be confined to. Defaults to the active org; a
  // multi-org user can pick another. Changing it SWITCHES the session's active
  // org (like the account switcher) so the resource picker + grant validation
  // scope to the same org the token binds to — otherwise you'd scope one org's
  // resources into another org's binding.
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgSwitching, setOrgSwitching] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      orgClient.list().catch(() => ({ data: [] as Org[] })),
      orgClient.getFullOrganization().catch(() => ({ data: null })),
    ]).then(([listRes, activeRes]) => {
      if (cancelled) return;
      const list = listRes.data ?? [];
      setOrgs(list);
      setOrgId((activeRes.data as { id: string } | null)?.id ?? list[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOrgChange = useCallback(async (next: string) => {
    setOrgSwitching(true);
    setError(null);
    try {
      // Switch the session server-side so ctx.organizationId (and thus the
      // picker's catalog + minterHasAccess) follows. Only commit the local
      // selection once the switch lands — on failure the picker stays on the
      // org it's actually scoped to. Grants are cleared: they referenced the
      // previous org's resource ids.
      const res = await orgClient.setActive({ organizationId: next });
      if (res?.error) {
        setError("Couldn't switch organization. Please try again.");
        return;
      }
      setActiveOrganizationId(next);
      setGrants([]);
      setOrgId(next);
    } catch {
      setError("Couldn't switch organization. Please try again.");
    } finally {
      setOrgSwitching(false);
    }
  }, []);

  const busy = submitting !== null || orgSwitching;

  const orgName = orgs.find((o) => o.id === orgId)?.name ?? "this organization";
  // limited + nothing picked would send zero grants → full access, which
  // contradicts the choice. Block it and steer the user.
  const limitedButEmpty = mode === "limited" && grants.length === 0;
  const summary =
    mode === "full"
      ? readOnly
        ? `Read-only access to everything in ${orgName}.`
        : `Full access to ${orgName} — deploy, create, and manage any resource.`
      : limitedButEmpty
        ? "Pick at least one resource, or switch to Full access."
        : `Limited to ${grants.length} resource${grants.length === 1 ? "" : "s"} in ${orgName}${readOnly ? ", read-only" : ""}.`;

  const act = useCallback(
    async (accept: boolean) => {
      setError(null);
      setSubmitting(accept ? "accept" : "deny");
      try {
        // Record the client's scope BEFORE issuing a token, so the binding
        // exists when the OAuth token first authenticates. Skip on deny.
        if (accept && clientId) {
          await tokensApi.mcpAuthorize({
            clientId,
            readOnly,
            // Full access → no resource grants (acts with the user's role);
            // limited → only the picked grants.
            grants: mode === "limited" ? grants : [],
            organizationId: orgId ?? undefined,
          });
        }
        const redirectURI = await postConsent(accept, consentCode);
        if (redirectURI) {
          window.location.href = redirectURI; // continue the OAuth flow
          return;
        }
        // No redirect (e.g. denied with no return) — send the user home.
        router.replace("/");
      } catch (err) {
        if ((err as { status?: number }).status === 401) {
          router.replace(`/login?returnTo=${encodeURIComponent(buildReturnTo(new URLSearchParams(searchParams.toString())))}`);
          return;
        }
        setError("Couldn't complete authorization. Please try again.");
        setSubmitting(null);
      }
    },
    [clientId, readOnly, grants, mode, orgId, consentCode, router, searchParams],
  );

  // Not signed in → bounce to login, returning here afterward.
  if (!isPending && !session) {
    router.replace(`/login?returnTo=${encodeURIComponent(buildReturnTo(new URLSearchParams(searchParams.toString())))}`);
    return null;
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!clientId) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-500">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        Missing client_id — this authorization link is invalid.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
          <Boxes className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Authorize MCP client</h1>
          <p className="text-sm text-muted-foreground">
            An MCP client wants to connect to your Openship account.
          </p>
        </div>
      </div>

      {/* Body — every access choice on the left rail · resource detail on the right. */}
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        {/* LEFT — identity, org, and the Full/Limited + read-only choices. */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-sm">
            <p className="text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">{session?.user?.email}</span>
            </p>
            <p className="mt-2 break-all text-muted-foreground">
              Client <span className="font-mono text-xs text-foreground">{clientId}</span>
            </p>
          </div>

          {/* Switching org changes your active workspace so the scope matches. */}
          {orgs.length > 0 && (
            <div className="rounded-xl border border-border/50 p-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Building2 className="size-3.5 text-muted-foreground" />
                Organization
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The client can act only within this organization.
              </p>
              {orgs.length > 1 ? (
                <div className="relative mt-2">
                  <select
                    value={orgId ?? ""}
                    onChange={(e) => handleOrgChange(e.target.value)}
                    disabled={busy}
                    className="w-full appearance-none rounded-lg border border-border/60 bg-background px-3 py-2 pr-9 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  {orgSwitching && (
                    <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm font-medium text-foreground">{orgs[0]?.name}</p>
              )}
            </div>
          )}

          {/* Access level: explicit Full vs Limited so what's granted is obvious. */}
          <div className="space-y-3 rounded-xl border border-border/50 p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">How much access to grant</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You can only grant access you already hold yourself.
              </p>
            </div>

            <div className="space-y-2">
              <AccessOption
                active={mode === "full"}
                disabled={busy}
                onClick={() => setMode("full")}
                title="Full access"
                badge="Recommended"
                desc={`Deploy, create, and manage everything in ${orgName} that you can. Best for your own client.`}
              />
              <AccessOption
                active={mode === "limited"}
                disabled={busy}
                onClick={() => setMode("limited")}
                title="Limited access"
                desc="Restrict the client to only the specific resources you choose."
              />
            </div>

            {/* Read-only modifier — applies to whichever mode is selected. */}
            <label className="flex cursor-pointer select-none items-start gap-3 rounded-xl border border-border/50 p-3">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                disabled={busy}
                className="mt-0.5 size-4 rounded border-border/60"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Lock className="size-3.5 text-muted-foreground" />
                  Read-only
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  The client can view but not deploy, change, or delete.
                </span>
              </span>
            </label>
          </div>

          {/* Plain-language summary of exactly what this Authorize will grant. */}
          <div
            className={`rounded-lg px-3 py-2 text-xs ${
              limitedButEmpty
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-muted/30 text-muted-foreground"
            }`}
          >
            {summary}
          </div>
        </div>

        {/* RIGHT — resource detail: the picker when Limited, a note when Full. */}
        <div className="rounded-xl border border-border/50 p-5">
          {mode === "limited" ? (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Resources this client can reach</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Choose the resources this client may access.
                </p>
              </div>
              <ResourcePicker
                key={orgId ?? "none"}
                value={grants}
                onChange={setGrants}
                availableTypes={grantableTypes(selfHosted)}
                defaultPermissions={["read", "write"]}
                disabled={busy}
              />
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {readOnly ? <Lock className="size-5" /> : <ShieldCheck className="size-5" />}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {readOnly ? "Full read-only access" : "Full access"}
                </p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  {readOnly
                    ? `This client can view everything in ${orgName} that you can, but can't make changes.`
                    : `This client acts with your role in ${orgName} — no resource restrictions. Switch to Limited to scope it to specific resources.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-sm text-red-500">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
        <Button variant="outline" disabled={busy} onClick={() => act(false)}>
          {submitting === "deny" ? <Loader2 className="size-4 animate-spin" /> : "Deny"}
        </Button>
        <Button disabled={busy || limitedButEmpty} onClick={() => act(true)}>
          {submitting === "accept" ? <Loader2 className="size-4 animate-spin" /> : "Authorize"}
        </Button>
      </div>
    </div>
  );
}

/** Radio-style access-mode card (Full / Limited). */
function AccessOption({
  active,
  disabled,
  onClick,
  title,
  desc,
  badge,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${
        active ? "border-primary/50 bg-primary/[0.06]" : "border-border/50 hover:bg-muted/20"
      }`}
    >
      <span
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
          active ? "border-primary" : "border-border/60"
        }`}
      >
        {active && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {title}
          {badge && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

export default function McpAuthorizePage() {
  return (
    <AuthShell maxWidth="max-w-4xl">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        }
      >
        <McpAuthorizeInner />
      </Suspense>
    </AuthShell>
  );
}
