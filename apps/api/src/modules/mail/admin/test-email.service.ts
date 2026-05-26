/**
 * Send a welcome / verification test email from the freshly-provisioned
 * mail server to the operator's personal inbox.
 *
 * Path: hands an RFC822 message to the local `sendmail` binary on the mail
 * VPS via SSH. Postfix takes care of DKIM signing, SPF alignment, queue
 * management, and delivery. We never reach the IMAP/SMTP daemons from the
 * dashboard — the message is enqueued locally and the MTA dispatches it.
 *
 * The HTML body is deliberately minimal: a single column, plain colors,
 * no images, no tracking pixels, real word density. That's the shape
 * Gmail / Outlook / Apple Mail's spam classifiers reward on day one.
 */

import { sshManager } from "../../../lib/ssh-manager";
import { queryOne } from "./psql-runner";

const EMAIL_RE = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export class TestEmailError extends Error {}

export interface SendTestEmailInput {
  to: string;
}

export interface SendTestEmailResult {
  to: string;
  from: string;
  messageId: string;
}

/**
 * Send the welcome message. Throws TestEmailError for user-facing failures
 * (bad address, no postmaster domain configured), plain Error for SSH /
 * sendmail failures (those surface as 500s in the controller).
 */
export async function sendTestEmail(
  serverId: string,
  input: SendTestEmailInput,
): Promise<SendTestEmailResult> {
  const to = input.to.trim().toLowerCase();
  if (!EMAIL_RE.test(to) || to.length > 255) {
    throw new TestEmailError("Enter a valid email address");
  }

  const row = await queryOne<{ domain: string }>(
    serverId,
    "SELECT domain FROM domain WHERE active = 1 ORDER BY created ASC LIMIT 1",
  );
  if (!row) {
    throw new TestEmailError("No active domain on this mail server yet");
  }
  const domain = row.domain;
  const from = `postmaster@${domain}`;

  const messageId = `<${randomToken(24)}@${domain}>`;
  const rfc822 = buildMessage({ to, from, domain, messageId });

  await sshManager.withExecutor(serverId, (exec) =>
    exec.exec(
      `sendmail -t -i -f ${shellQuote(from)} <<'__OPENSHIP_RFC822_EOF__'\n${rfc822}\n__OPENSHIP_RFC822_EOF__`,
    ),
  );

  return { to, from, messageId };
}

// ─── Message composition ─────────────────────────────────────────────────────

function buildMessage(args: {
  to: string;
  from: string;
  domain: string;
  messageId: string;
}): string {
  const { to, from, domain, messageId } = args;
  const date = formatRFC822Date(new Date());
  const boundary = `==openship_${randomToken(20)}`;

  const subject = `Welcome — your mail server at ${domain} is live`;
  const text = plainTextBody({ to, from, domain });
  const html = htmlBody({ to, from, domain });

  return [
    `From: openship <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `X-Mailer: openship-mail-admin`,
    ``,
    `This is a multi-part message in MIME format.`,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    text,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

function plainTextBody(args: { to: string; from: string; domain: string }): string {
  const { from, domain } = args;
  return [
    `Hi there,`,
    ``,
    `Your self-hosted mail server at ${domain} is up and running. This message`,
    `was sent from ${from} directly through your own MTA — no third-party`,
    `relay involved. The fact that it reached your inbox means the basics`,
    `are wired correctly: DNS, TLS, DKIM, and SPF.`,
    ``,
    `What to expect in the next few days:`,
    ``,
    `  - Some providers may file this domain to spam for the first 24-48`,
    `    hours while reputation builds. That's normal for any brand new`,
    `    sending domain. Mark this message as "not spam" and reputation`,
    `    catches up fast.`,
    ``,
    `  - You can already wire ${domain} into your application and start`,
    `    sending. Use the SMTP credentials from the admin panel.`,
    ``,
    `  - Add more mailboxes from the Mailboxes tab when you need them.`,
    ``,
    `Welcome to running your own mail.`,
    ``,
    `— openship`,
  ].join("\r\n");
}

function htmlBody(args: { to: string; from: string; domain: string }): string {
  const { from, domain } = args;
  // Single-column, no images, no tracking pixels. Tables for max client
  // compat. Conservative color palette aligned with the dashboard.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your mail server is live</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f8;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;background:#ffffff;border:1px solid #e6e7eb;border-radius:14px;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;color:#6b7280;text-transform:uppercase;font-weight:600;">openship mail</p>
                <h1 style="margin:0;font-size:22px;line-height:1.25;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">Your mail server is live.</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 4px 32px;font-size:15px;line-height:1.6;color:#374151;">
                <p style="margin:0 0 14px;">This message was sent from <strong style="color:#0a0a0a;">${escapeHtml(from)}</strong> directly through your own MTA. No third-party relay involved.</p>
                <p style="margin:0 0 14px;">If it reached your inbox, the basics are wired up: DNS, TLS, DKIM and SPF are healthy.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8eb;border:1px solid #f5d387;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13.5px;line-height:1.55;color:#7a4a00;">
                      <strong style="color:#5c3500;">First 24-48 hours.</strong> A brand-new domain has no sending reputation yet — some providers may file early mail to spam while that builds. Mark this message as "not spam" and reputation catches up quickly.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 4px 32px;font-size:14.5px;line-height:1.6;color:#374151;">
                <p style="margin:0 0 12px;">You can already start sending. Wire <strong style="color:#0a0a0a;">${escapeHtml(domain)}</strong> into your application using the SMTP credentials from the admin panel, and add more mailboxes from the Mailboxes tab as you need them.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px 32px;">
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;">Welcome to running your own mail.<br/>— openship</p>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;font-size:11.5px;color:#9ca3af;">Sent from ${escapeHtml(domain)} • You received this because you provisioned this mail server.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  return s;
}

function formatRFC822Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const pad = (n: number) => n.toString().padStart(2, "0");
  const day = days[d.getUTCDay()];
  const date = pad(d.getUTCDate());
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${day}, ${date} ${month} ${year} ${hh}:${mm}:${ss} +0000`;
}
