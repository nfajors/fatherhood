"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2.5 text-ink";
const SENT = "If there's an account for that email, a link is on its way. It works for an hour. Check your spam folder if it doesn't arrive in a few minutes.";

/** Ask for a reset link. The answer is the same whether or not the email has an account. */
export function ForgotPasswordForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    setPending(true);
    setError(null);
    const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (result.error) {
      setError(result.error.status === 429 ? "Too many requests. Please wait a minute and try again." : "Something went wrong. Please try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-gold-100 p-4 text-sm leading-relaxed">{SENT}</p>
        <p className="text-sm text-muted">
          <Link href="/sign-in" className="underline">Back to sign in</Link>
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        Email
        <input name="email" type="email" required autoComplete="email" defaultValue={initialEmail} className={field} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait..." : "Email me a link"}
      </Button>
      <p className="text-center text-sm text-muted">
        Remembered it? <Link href="/sign-in" className="underline">Sign in</Link>
      </p>
    </form>
  );
}

/** Choose the new password, from the emailed link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (result.error) {
      const code = result.error.code;
      setError(
        code === "INVALID_TOKEN"
          ? "This link has expired or was already used. Ask for a new one below."
          : code === "PASSWORD_TOO_SHORT"
            ? "Use at least 10 characters."
            : (result.error.message ?? "Something went wrong. Please try again."),
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-gold-100 p-4 text-sm leading-relaxed">
          Your password is set. For your safety we signed you out everywhere, including the app. Sign in with your email and new password.
        </p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">
          New password
          <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" aria-describedby="password-hint" className={field} />
        </label>
        <p id="password-hint" className="mt-1 text-xs text-muted">At least 10 characters.</p>
      </div>
      <label className="block text-sm font-medium">
        New password again
        <input name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={field} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}{" "}
          {error.startsWith("This link") ? <Link href="/forgot-password" className="underline">Get a new link</Link> : null}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait..." : "Save password"}
      </Button>
    </form>
  );
}

/** Account page: email yourself a link to set (Google sign-ups) or change your password. */
export function PasswordLinkButton({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">("idle");
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={state === "pending" || state === "sent"}
        onClick={async () => {
          setState("pending");
          const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
          setState(result.error ? "error" : "sent");
        }}
      >
        {hasPassword ? "Email me a link to change it" : "Email me a link to set one"}
      </Button>
      {state === "sent" ? <p role="status" className="mt-2 text-sm text-muted">Sent to {email}. The link works for an hour.</p> : null}
      {state === "error" ? <p role="alert" className="mt-2 text-sm text-red-700">Couldn&apos;t send it just now. Please try again in a minute.</p> : null}
    </div>
  );
}
