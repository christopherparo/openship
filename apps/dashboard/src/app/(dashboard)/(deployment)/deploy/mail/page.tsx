"use client";

/**
 * Webmail deploy screen — opinionated picker that hands off to the standard
 * build session UI.
 *
 * Flow:
 *   1. Operator opens /emails → Deploy webmail (carries mail serverId).
 *   2. Picks target host + domain on this page.
 *   3. Submit creates a project + queued deployment + build session and
 *      redirects to /build/[deploymentId], where the regular SSE stream
 *      drives the terminal + stepper UI.
 *
 * No build/start-command knobs — the engine is fully prescriptive for
 * webmail. Operators only choose where and what domain.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Inbox,
  Loader2,
  Server,
} from "lucide-react";
import { PageContainer } from "@/components/ui/PageContainer";
import { OptionCard } from "../[slug]/components/DeployTargetStep";
import { useToast } from "@/context/ToastContext";
import {
  mailApi,
  type MailSetupStatus,
  type WebmailTargetOption,
} from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api/client";

export default function DeployMailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const mailServerId = searchParams.get("serverId") ?? "";

  const [status, setStatus] = useState<MailSetupStatus | null>(null);
  const [bootReady, setBootReady] = useState(false);

  const [domain, setDomain] = useState("");
  const [targetServerId, setTargetServerId] = useState("");
  const [targets, setTargets] = useState<WebmailTargetOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!mailServerId) {
      setBootReady(true);
      return;
    }
    let cancelled = false;
    Promise.all([
      mailApi.getStatus(mailServerId).catch(() => null),
      mailApi.webmail.listTargets(mailServerId).catch(() => ({ options: [] })),
    ]).then(([st, tg]) => {
      if (cancelled) return;
      if (st) {
        setStatus(st);
        if (st.domain) setDomain(`mail.${st.domain}`);
      }
      setTargets(tg.options);
      const first = tg.options.find((o) => !o.disabled);
      if (first) setTargetServerId(first.serverId);
      setBootReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mailServerId]);

  const canSubmit = useMemo(() => {
    if (!domain || !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
      return false;
    if (!targetServerId) return false;
    return true;
  }, [domain, targetServerId]);

  const startDeploy = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { deploymentId } = await mailApi.webmail.deployAsProject({
        mailServerId,
        targetServerId,
        hostname: domain.toLowerCase(),
      });
      router.push(`/build/${deploymentId}`);
    } catch (err) {
      toast.showToast(
        getApiErrorMessage(err, "Failed to start deploy"),
        "error",
        "Deploy failed",
      );
      setSubmitting(false);
    }
  };

  if (!mailServerId) {
    return (
      <PageContainer>
        <div className="bg-card rounded-2xl border border-border/50 p-8 text-center">
          <p className="text-sm text-foreground font-medium">Missing mail server</p>
          <p className="text-sm text-muted-foreground mt-1">
            Open this page from the mail overview.
          </p>
          <Link
            href="/emails"
            className="mt-3 text-sm font-medium text-primary hover:underline inline-block"
          >
            Back to mail
          </Link>
        </div>
      </PageContainer>
    );
  }

  const selectedTarget = targets.find((t) => t.serverId === targetServerId);
  const mailHostname = status?.domain ? `mail.${status.domain}` : "";
  const domainPlaceholder = status?.domain
    ? `mail.${status.domain}`
    : "mail.example.com";

  return (
    <PageContainer>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Deploy webmail
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stand up a self-hosted webmail at the domain you choose.
          </p>
        </div>
        <Link
          href="/emails"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="size-3.5" /> Back to mail
        </Link>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          <Section
            title="Deploy to"
            hint="Webmail can live on this mail server or on another openship-managed host."
          >
            {!bootReady ? (
              <div className="rounded-xl border border-border/50 bg-card px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Loading targets…
              </div>
            ) : (
              <div className="space-y-2">
                {targets.map((t) => {
                  const Icon =
                    t.kind === "mail"
                      ? Inbox
                      : t.kind === "server"
                        ? Server
                        : Globe;
                  return (
                    <OptionCard
                      key={`${t.kind}-${t.serverId || t.label}`}
                      value={t.serverId || t.label}
                      selected={targetServerId === t.serverId}
                      onSelect={() => {
                        if (!t.disabled) setTargetServerId(t.serverId);
                      }}
                      icon={<Icon className="size-5" />}
                      label={t.label}
                      description={
                        t.description ||
                        (t.disabled ? t.disabledReason || "Not available" : "")
                      }
                    />
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title="Domain"
            hint="The URL operators will visit. DNS must point at the deploy target."
          >
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={domainPlaceholder}
              className="w-full px-4 py-3 bg-card border border-border/50 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              spellCheck={false}
              autoComplete="off"
              disabled={submitting}
            />
          </Section>
        </div>

        <aside className="lg:sticky lg:top-6 h-fit space-y-4">
          <div className="bg-card rounded-xl border border-border/50 p-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Summary
            </p>
            <SummaryRow label="Target" value={selectedTarget?.label ?? "—"} />
            <SummaryRow label="Domain" value={domain || "—"} />
            {mailHostname && <SummaryRow label="Mail server" value={mailHostname} />}
          </div>
          <button
            type="button"
            onClick={startDeploy}
            disabled={!canSubmit || submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Starting…
              </>
            ) : (
              <>
                Deploy webmail
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </aside>
      </div>
    </PageContainer>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground truncate">{value}</span>
    </div>
  );
}
