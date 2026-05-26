"use client";

/**
 * Advanced tab — power-user surface.
 *
 * Layout (top → bottom):
 *   1. Protocol settings — the host/port/encryption pairs for inbound
 *      (IMAP) and outbound (SMTP). Useful when wiring a client manually
 *      but noisy on the Overview, so it lives here.
 *   2. Components       — full per-daemon control panel. Start, stop,
 *      restart, view logs for every unit on the box. Health tab only
 *      surfaces a Fix CTA for broken components; routine power-user
 *      control lives here.
 *   3. Mail-stack tools — bulk recovery actions (restart all daemons).
 *      Less destructive than the danger zone — these touch only the
 *      running stack, never the on-disk state.
 *   4. Danger zone      — re-run wizard, reset on-server state. Tucked
 *      away so the operator isn't one mis-click from a destructive
 *      action while just reading credentials.
 *   5. Install metadata — server ID, primary domain, install timestamps.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleX,
  Cpu,
  Inbox,
  Lock,
  Loader2,
  Play,
  RotateCw,
  ScrollText,
  Send,
  Settings2,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  mailApi,
  mailAdminApi,
  getApiErrorMessage,
  type BulkRestartResult,
  type ComponentAction,
  type MailComponentHealth,
  type MailComponentStatus,
  type MailCredentials,
  type MailSetupStatus,
} from "@/lib/api";
import { useModal } from "@/context/ModalContext";
import { useToast } from "@/context/ToastContext";
import { FormModalContent } from "./_shared/form-modal-content";
import { LogsDrawer } from "./_shared/logs-drawer";

interface AdvancedTabProps {
  status: MailSetupStatus;
  serverId: string;
  onChanged: () => void;
}

export function AdvancedTab({ status, serverId, onChanged }: AdvancedTabProps) {
  const { showModal, hideModal } = useModal();
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const openReset = () => {
    const id = showModal({
      maxWidth: "480px",
      showCloseButton: false,
      customContent: (
        <FormModalContent
          title="Reset on-server state?"
          description="Wipes openship's tracking record on the mail VPS (/root/.openship-mail-state.json). The running mail stack is not touched — every mailbox, message, and queue stays intact."
          submitLabel="Reset state"
          submittingLabel="Resetting…"
          submitVariant="danger"
          onSubmit={async () => {
            setResetError(null);
            setResetting(true);
            try {
              await mailApi.resetSetup(serverId);
              hideModal(id);
              onChanged();
            } catch (err) {
              setResetError(getApiErrorMessage(err, "Reset failed"));
              throw err;
            } finally {
              setResetting(false);
            }
          }}
          onCancel={() => hideModal(id)}
        >
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
            After this, the /emails page will show the install wizard again
            for this server. You can then either re-run from step 1 or pick
            up from a specific step.
          </div>
        </FormModalContent>
      ),
    });
  };

  return (
    <div className="space-y-8">
      {/* Protocol settings */}
      {status.credentials && (
        <section className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <Settings2
                className="size-4 text-muted-foreground"
                strokeWidth={2.25}
              />
              <h2 className="text-lg font-semibold text-foreground">
                Protocol settings
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Host, port, and encryption for inbound (IMAP) and outbound
              (SMTP). Use these when configuring a mail client by hand —
              most clients can also discover them from the email address
              alone.
            </p>
          </div>
          <ProtocolCard credentials={status.credentials} />
        </section>
      )}

      {/* Components */}
      <ComponentsSection serverId={serverId} />

      {/* Mail-stack recovery tools */}
      <MailStackToolsSection serverId={serverId} />

      {/* Danger zone */}
      <section className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="size-4 text-amber-600 dark:text-amber-400"
              strokeWidth={2.25}
            />
            <h2 className="text-lg font-semibold text-foreground">Danger zone</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            These actions can disrupt a working mail server or clear
            important tracking state. Read the description on each card
            before clicking.
          </p>
        </div>

        {/* Re-run setup */}
        <DangerCard
          icon={RotateCw}
          title="Re-run setup wizard"
          description="Opens the install wizard pointed at this server. Useful after a DNS change, a domain rename, or to retry a failed step. The wizard detects an existing install and offers per-step retry rather than wiping state."
          action={
            <Link
              href={`/emails?serverId=${encodeURIComponent(serverId)}&force=wizard`}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-muted text-foreground hover:bg-muted/80 border border-border transition-colors"
            >
              <RotateCw className="size-3.5" />
              Open wizard
            </Link>
          }
        />

        {/* Reset on-server state */}
        <DangerCard
          icon={Trash2}
          title="Reset on-server state"
          description="Removes /root/.openship-mail-state.json from the VPS. Does NOT uninstall the mail stack or touch any mailboxes — the server keeps running. Use after a manual purge or re-image, when openship's tracking has drifted from reality."
          action={
            <button
              onClick={openReset}
              disabled={resetting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {resetting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Reset state
            </button>
          }
          error={resetError}
        />
      </section>

      {/* Install metadata */}
      <section>
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50">
            <h3 className="text-[14px] font-semibold text-foreground">
              Install metadata
            </h3>
          </div>
          <dl className="divide-y divide-border/40">
            <MetaRow label="Server ID" value={serverId} mono />
            <MetaRow label="Primary domain" value={status.domain ?? "—"} />
            {status.startedAt && (
              <MetaRow
                label="Started at"
                value={new Date(status.startedAt).toLocaleString()}
              />
            )}
            {status.finishedAt && (
              <MetaRow
                label="Finished at"
                value={new Date(status.finishedAt).toLocaleString()}
              />
            )}
          </dl>
        </div>
      </section>
    </div>
  );
}

// ─── Protocol settings card ──────────────────────────────────────────────────

function ProtocolCard({ credentials }: { credentials: MailCredentials }) {
  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ProtocolBlock
          icon={Inbox}
          label="Incoming · IMAP"
          host={credentials.imapHost}
          port={credentials.imapPort}
          encryption="SSL/TLS"
        />
        <ProtocolBlock
          icon={Send}
          label="Outgoing · SMTP"
          host={credentials.smtpHost}
          port={credentials.smtpPort}
          encryption="STARTTLS"
        />
      </div>
      <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 px-3.5 py-2.5">
        <p className="text-xs text-foreground/90 leading-relaxed">
          <Lock className="inline-block size-3 mr-1 -mt-0.5 text-muted-foreground" />
          Username on both servers is your <strong>full email address</strong>
          {" "}— e.g.{" "}
          <code className="font-mono text-[11.5px] px-1 py-0.5 rounded bg-card border border-border/40">
            {credentials.username}
          </code>
          . Set the password from <em>Overview → Postmaster credentials → Change
          password</em>; openship never stores the cleartext, so use a manager
          (1Password, Bitwarden, etc.) to save it.
        </p>
      </div>
    </div>
  );
}

function ProtocolBlock({
  icon: Icon,
  label,
  host,
  port,
  encryption,
}: {
  icon: typeof Inbox;
  label: string;
  host: string;
  port: number;
  encryption: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="size-3.5 text-muted-foreground" strokeWidth={2} />
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
      </div>
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex items-center gap-3">
          <dt className="w-16 text-xs text-muted-foreground">Host</dt>
          <dd className="font-mono text-foreground truncate">{host}</dd>
        </div>
        <div className="flex items-center gap-3">
          <dt className="w-16 text-xs text-muted-foreground">Port</dt>
          <dd className="font-mono text-foreground">{port}</dd>
        </div>
        <div className="flex items-center gap-3">
          <dt className="w-16 text-xs text-muted-foreground">Security</dt>
          <dd className="font-mono text-foreground">{encryption}</dd>
        </div>
      </dl>
    </div>
  );
}

function DangerCard({
  icon: Icon,
  title,
  description,
  action,
  error,
}: {
  icon: typeof RotateCw;
  title: string;
  description: string;
  action: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
          <Icon className="size-5 text-amber-600 dark:text-amber-400" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            {description}
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <dt className="w-32 text-xs font-medium text-muted-foreground shrink-0">
        {label}
      </dt>
      <dd
        className={`text-[13px] text-foreground truncate ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Components section ──────────────────────────────────────────────────────

/**
 * Full per-component control. One card per daemon with start/stop/restart
 * and a Logs button. Status auto-polls every 10s — same cadence as the
 * Health tab so the two surfaces stay in agreement without coordination.
 *
 * This is the surface to use when an operator wants to manipulate a
 * specific unit (e.g. stop ClamAV temporarily to free RAM). Health tab is
 * the "is it green?" surface; this is "let me drive."
 */
function ComponentsSection({ serverId }: { serverId: string }) {
  const [components, setComponents] = useState<MailComponentHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tick = useCallback(async () => {
    try {
      const r = await mailApi.getHealth(serverId);
      setComponents(r.components);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    }
  }, [serverId]);

  useEffect(() => {
    void tick();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void tick();
    }, 10_000);
    return () => clearInterval(id);
  }, [tick]);

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" strokeWidth={2.25} />
          <h2 className="text-lg font-semibold text-foreground">Components</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Start, stop, restart, or tail logs for any unit on the mail box.
          Status polls every 10 seconds. The Health tab will flag broken
          components — use this surface for routine manipulation.
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        {error && (
          <div className="px-5 py-3 text-sm text-red-600 dark:text-red-400 border-b border-border/40 bg-red-500/5">
            {error}
          </div>
        )}
        {components === null && !error ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Loading components…
          </div>
        ) : components ? (
          <div className="divide-y divide-border/40">
            {components.map((c) => (
              <ComponentControlRow
                key={c.key}
                serverId={serverId}
                component={c}
                onActed={tick}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ComponentControlRow({
  serverId,
  component,
  onActed,
}: {
  serverId: string;
  component: MailComponentHealth;
  onActed: () => Promise<void> | void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<ComponentAction | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const presentation = componentPresentation(component.status);

  const act = async (action: ComponentAction) => {
    if (busy) return;
    setBusy(action);
    try {
      await mailAdminApi.components.action(serverId, component.key, action);
      showToast(`${component.label} ${actionPastTense(action)}`, "success");
      await onActed();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : `Failed to ${action}`,
        "error",
        `${component.label} ${action} failed`,
      );
    } finally {
      setBusy(null);
    }
  };

  const isRunning = component.status === "active";
  const canStart =
    component.status === "inactive" || component.status === "failed";

  return (
    <>
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${presentation.iconBg}`}
        >
          <presentation.Icon
            className={`size-4 ${presentation.iconColor}`}
            strokeWidth={2}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13.5px] font-medium text-foreground truncate">
              {component.label}
            </p>
            <span className="font-mono text-[11px] text-muted-foreground/80 truncate">
              {component.unit}
            </span>
            <span
              className={`text-[11px] font-medium ${presentation.textColor}`}
            >
              · {presentation.label}
            </span>
          </div>
          <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">
            {component.description}
          </p>
        </div>
        {component.status !== "missing" && (
          <div className="flex items-center gap-1 shrink-0">
            {isRunning && (
              <ControlIconButton
                title="Restart"
                onClick={() => act("restart")}
                busy={busy === "restart"}
                disabled={busy !== null}
                icon={RotateCw}
              />
            )}
            {canStart && (
              <ControlIconButton
                title="Start"
                onClick={() => act("start")}
                busy={busy === "start"}
                disabled={busy !== null}
                icon={Play}
              />
            )}
            {isRunning && (
              <ControlIconButton
                title="Stop"
                onClick={() => act("stop")}
                busy={busy === "stop"}
                disabled={busy !== null}
                icon={Square}
              />
            )}
            <ControlIconButton
              title="Logs"
              onClick={() => setLogsOpen(true)}
              busy={false}
              disabled={false}
              icon={ScrollText}
            />
          </div>
        )}
      </div>
      {logsOpen && (
        <LogsDrawer
          serverId={serverId}
          componentKey={component.key}
          unit={component.unit}
          label={component.label}
          onClose={() => setLogsOpen(false)}
        />
      )}
    </>
  );
}

function ControlIconButton({
  title,
  onClick,
  busy,
  disabled,
  icon: Icon,
}: {
  title: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  icon: typeof RotateCw;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
      ) : (
        <Icon className="size-3.5" strokeWidth={2.25} />
      )}
    </button>
  );
}

function actionPastTense(action: ComponentAction): string {
  switch (action) {
    case "restart":
      return "restarted";
    case "start":
      return "started";
    case "stop":
      return "stopped";
  }
}

interface ComponentPresentation {
  Icon: typeof CheckCircle2;
  iconBg: string;
  iconColor: string;
  textColor: string;
  label: string;
}

function componentPresentation(
  status: MailComponentStatus,
): ComponentPresentation {
  switch (status) {
    case "active":
      return {
        Icon: CheckCircle2,
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-600 dark:text-emerald-400",
        textColor: "text-emerald-700 dark:text-emerald-400",
        label: "Running",
      };
    case "activating":
      return {
        Icon: Loader2,
        iconBg: "bg-blue-500/10",
        iconColor: "text-blue-600 dark:text-blue-400 animate-spin",
        textColor: "text-blue-700 dark:text-blue-400",
        label: "Starting",
      };
    case "deactivating":
      return {
        Icon: Loader2,
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-600 dark:text-amber-400 animate-spin",
        textColor: "text-amber-700 dark:text-amber-400",
        label: "Stopping",
      };
    case "inactive":
      return {
        Icon: CircleDashed,
        iconBg: "bg-muted",
        iconColor: "text-muted-foreground",
        textColor: "text-muted-foreground",
        label: "Stopped",
      };
    case "failed":
      return {
        Icon: CircleX,
        iconBg: "bg-red-500/10",
        iconColor: "text-red-600 dark:text-red-400",
        textColor: "text-red-600 dark:text-red-400",
        label: "Failed",
      };
    case "missing":
      return {
        Icon: CircleAlert,
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-600 dark:text-amber-400",
        textColor: "text-amber-700 dark:text-amber-400",
        label: "Not installed",
      };
    default:
      return {
        Icon: CircleDashed,
        iconBg: "bg-muted",
        iconColor: "text-muted-foreground",
        textColor: "text-muted-foreground",
        label: "Unknown",
      };
  }
}

// ─── Mail-stack tools (bulk restart) ─────────────────────────────────────────

/**
 * Common "the box went weird after a deploy" recovery. Restarts every
 * mail-stack unit in one round-trip. Less invasive than the danger zone:
 * it does not touch state, mailboxes, or DNS — it just cycles the running
 * daemons. Reports per-unit success in a toast.
 */
function MailStackToolsSection({ serverId }: { serverId: string }) {
  const { showToast } = useToast();
  const { showModal, hideModal } = useModal();
  const [restarting, setRestarting] = useState(false);

  const runRestart = async () => {
    setRestarting(true);
    try {
      const r: BulkRestartResult = await mailAdminApi.components.restartAll(
        serverId,
      );
      const failures = r.results.filter((x) => !x.ok);
      if (failures.length === 0) {
        showToast(
          `Restarted ${r.results.length} mail daemons.`,
          "success",
          "Mail stack restarted",
        );
      } else {
        showToast(
          `${failures.length} of ${r.results.length} failed: ${failures
            .map((f) => f.unit)
            .join(", ")}`,
          "error",
          "Partial restart",
        );
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Restart failed",
        "error",
        "Mail stack restart failed",
      );
    } finally {
      setRestarting(false);
    }
  };

  const openConfirm = () => {
    const id = showModal({
      maxWidth: "480px",
      showCloseButton: false,
      customContent: (
        <FormModalContent
          title="Restart the mail stack?"
          description="Cycles every running mail daemon (the queue receiver, the IMAP service, the spam pipeline, fail2ban, and PostgreSQL). Mail flow pauses for a few seconds while units come back up. Mailboxes, queues, and DNS are untouched."
          submitLabel="Restart stack"
          submittingLabel="Restarting…"
          submitVariant="primary"
          onSubmit={async () => {
            await runRestart();
            hideModal(id);
          }}
          onCancel={() => hideModal(id)}
        >
          <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground leading-relaxed">
            Use this when something looks off right after a deploy or a
            config change — most transient breakage clears with a cycle.
          </div>
        </FormModalContent>
      ),
    });
  };

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Wrench className="size-4 text-muted-foreground" strokeWidth={2.25} />
          <h2 className="text-lg font-semibold text-foreground">
            Mail-stack tools
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Recovery actions that touch the running stack without altering
          state. Safe to run anytime; mail flow blips for a few seconds.
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <RotateCw
              className="size-5 text-foreground/80"
              strokeWidth={1.75}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-foreground">
              Restart mail stack
            </h4>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Cycles every mail daemon at once. The fastest fix when
              something flaked after a deploy — login fails, queue
              stalls, etc.
            </p>
          </div>
          <button
            onClick={openConfirm}
            disabled={restarting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 shrink-0"
          >
            {restarting ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
            ) : (
              <RotateCw className="size-3.5" strokeWidth={2.25} />
            )}
            Restart stack
          </button>
        </div>
      </div>
    </section>
  );
}
