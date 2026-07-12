"use client";

/**
 * MCP connection card. Shows the JSON-RPC endpoint for the current runtime
 * target. Primary path is OAuth (clients discover + authorize in the browser);
 * a Personal Access Token is the fallback for clients without OAuth.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, Copy, Check, ShieldCheck, Unplug, Loader2, ChevronDown } from "lucide-react";
import { SettingsSection } from "./SettingsSection";
import { getRestApiBaseUrl } from "@/lib/api/urls";
import { tokensApi, getApiErrorMessage, type McpClient } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };
  return { copied, copy };
}

function CopyRow({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
        {value || "…"}
      </code>
      <button
        onClick={() => copy(value)}
        disabled={!value}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-3 pr-16 font-mono text-xs leading-relaxed text-foreground">
        {value}
      </pre>
      <button
        onClick={() => copy(value)}
        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function McpConnection() {
  const { showToast } = useToast();

  // Resolve on the client — getRestApiBaseUrl reads window.location, so compute
  // after mount to avoid an SSR/hydration mismatch.
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => {
    setEndpoint(`${getRestApiBaseUrl()}/mcp`);
  }, []);

  // Connected clients own the layout: once anything is connected the list leads
  // and the how-to collapses behind "Connect another client". Fetch lives here
  // (not in a child) so the list + guide render in one coherent pass — no
  // expanded-then-collapse flash for users who do have connections.
  const [clients, setClients] = useState<McpClient[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tokensApi
      .listMcpClients()
      .then((res) => !cancelled && setClients(res.data ?? []))
      .catch(() => !cancelled && setClients([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const disconnect = async (clientId: string) => {
    setDisconnecting(clientId);
    try {
      await tokensApi.disconnectMcpClient(clientId);
      setClients((prev) => (prev ?? []).filter((c) => c.clientId !== clientId));
      showToast("MCP client disconnected", "success");
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to disconnect"), "error", "Disconnect");
    } finally {
      setDisconnecting(null);
      setConfirmId(null);
    }
  };

  const hasClients = (clients?.length ?? 0) > 0;

  const configSnippet = [
    "{",
    '  "mcpServers": {',
    '    "openship": {',
    `      "url": "${endpoint || "https://<your-openship>/api/mcp"}",`,
    '      "headers": { "Authorization": "Bearer opsh_pat_…" }',
    "    }",
    "  }",
    "}",
  ].join("\n");

  return (
    <SettingsSection
      icon={Boxes}
      title="MCP"
      description="Connect AI agents to your Openship API over the Model Context Protocol."
      iconBg="bg-emerald-500/10"
      iconColor="text-emerald-500"
    >
      <div className="space-y-4">
        {clients === null ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/50 px-4 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        ) : hasClients ? (
          <>
            <ClientsList
              clients={clients}
              confirmId={confirmId}
              setConfirmId={setConfirmId}
              disconnecting={disconnecting}
              onDisconnect={disconnect}
            />

            {/* Once something is connected, the how-to collapses out of the way. */}
            <div className="rounded-xl border border-border/50">
              <button
                type="button"
                onClick={() => setGuideOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/20"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="size-4 text-emerald-500" />
                  Connect another client
                </span>
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${guideOpen ? "rotate-180" : ""}`}
                />
              </button>
              {guideOpen && (
                <div className="space-y-4 border-t border-border/40 px-4 py-4">
                  <GuideBody endpoint={endpoint} configSnippet={configSnippet} />
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Nothing connected yet — lead with the how-to + explainer banner. */}
            <div className="flex gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <div className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Paste the endpoint below into your MCP client</span>{" "}
                (Claude, Cursor, …) — it opens a browser window where you approve access and choose what the client
                can reach. No token to copy. Openship is a standards-compliant OAuth 2.1 MCP server.
              </div>
            </div>
            <GuideBody endpoint={endpoint} configSnippet={configSnippet} />
          </>
        )}
      </div>
    </SettingsSection>
  );
}

/** The connection how-to: endpoint + static-token fallback. Shared by the
 *  onboarding (nothing connected) and the collapsible "connect another" paths. */
function GuideBody({ endpoint, configSnippet }: { endpoint: string; configSnippet: string }) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-xs font-medium text-foreground">Endpoint</p>
        <CopyRow value={endpoint} />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Streamable-HTTP JSON-RPC. OAuth-capable clients authorize in the browser; on approval you pick
          read-only + which resources the client may access.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-foreground">Without OAuth (static token)</p>
        <CopyBlock value={configSnippet} />
        <p className="mt-1.5 text-xs text-muted-foreground">
          For clients that don&apos;t support OAuth — or for a fixed, scoped token — create one in the{" "}
          <Link
            href="/settings?tab=tokens"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            Tokens
          </Link>{" "}
          tab and replace <code className="font-mono">opsh_pat_…</code>. A read-only token limits the agent to reads.
        </p>
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Presentational list of connected MCP clients (OAuth bindings) with a
 * two-step disconnect. State lives in the parent so the list + how-to render
 * coherently. Disconnect revokes the client's tokens server-side.
 */
function ClientsList({
  clients,
  confirmId,
  setConfirmId,
  disconnecting,
  onDisconnect,
}: {
  clients: McpClient[];
  confirmId: string | null;
  setConfirmId: (id: string | null) => void;
  disconnecting: string | null;
  onDisconnect: (clientId: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-foreground">Connected clients</p>
      <div className="divide-y divide-border/40 rounded-xl border border-border/50">
        {clients.map((c) => {
          const id = c.clientId ?? "";
          const confirming = confirmId === id;
          const busy = disconnecting === id;
          return (
            <div key={id || c.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      c.readOnly
                        ? "bg-muted text-muted-foreground"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {c.readOnly ? "Read-only" : "Full control"}
                  </span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {c.scoped
                      ? `${c.grantCount} resource${c.grantCount === 1 ? "" : "s"}`
                      : "All resources"}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {c.organizationName ? `${c.organizationName} · ` : ""}
                  Authorized {formatDate(c.authorizedAt)}
                  {c.lastUsedAt ? ` · last used ${formatDate(c.lastUsedAt)}` : ""}
                </p>
              </div>
              {confirming ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => setConfirmId(null)}
                    disabled={busy}
                    className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => onDisconnect(id)}
                    disabled={busy || !id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />}
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(id)}
                  disabled={!id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                >
                  <Unplug className="size-3.5" />
                  Disconnect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
