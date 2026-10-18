/**
 * Outgoing email. Resend in production; without RESEND_API_KEY, messages are
 * logged instead so local development and tests never send real mail.
 */
import { Resend } from "resend";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Resend skips a send whose key it has already seen, so retries never duplicate an email. */
  idempotencyKey?: string;
  /** Extra headers, e.g. List-Unsubscribe on email people can opt out of. */
  headers?: Record<string, string>;
};

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export class EmailError extends Error {}

export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send(
      { from: this.from, to: message.to, subject: message.subject, html: message.html, text: message.text, replyTo: message.replyTo, headers: message.headers },
      message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
    );
    if (error) throw new EmailError(`Email to ${message.to} failed: ${error.message}`);
  }
}

/** Development stand-in: prints the email instead of sending it. */
export class ConsoleMailer implements Mailer {
  async send(message: EmailMessage): Promise<void> {
    console.info(`[email] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

let mailer: Mailer | undefined;

export function getMailer(): Mailer {
  mailer ??= process.env.RESEND_API_KEY
    ? new ResendMailer(process.env.RESEND_API_KEY, process.env.EMAIL_FROM ?? "Fatherhood.School <hello@fatherhood.school>")
    : new ConsoleMailer();
  return mailer;
}
