"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { accountLinks } from "@/components/header-account";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * The header on small screens: Join (when signed out) and a menu button that opens
 * every main and account link as a full-width list. Closes on navigation and Escape.
 */
export function MobileMenu({ nav }: { nav: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const { data, isPending } = authClient.useSession();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const account = data ? accountLinks((data.user as { role?: string }).role) : [{ href: "/sign-in", label: "Sign in" }];
  const item = (href: string, label: string) => {
    const current = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={current ? "page" : undefined}
          onClick={() => setOpen(false)}
          className={`flex min-h-12 items-center rounded-md px-3 text-base ${current ? "bg-white/10 font-semibold text-white" : "text-white/85 hover:bg-white/10 hover:text-white"}`}
        >
          {label}
        </Link>
      </li>
    );
  };

  return (
    <>
      {!isPending && !data && (
        <Button asChild size="sm">
          <Link href="/pricing">Join</Link>
        </Button>
      )}
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 items-center justify-center rounded-md text-white/85 hover:bg-white/10 hover:text-white"
      >
        <span className="sr-only">{open ? "Close menu" : "Menu"}</span>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-6">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-white/10 bg-navy-950 px-4 pb-6 shadow-xl">
        <nav aria-label="Main">
          <ul className="space-y-1 pt-2">{nav.map((l) => item(l.href, l.label))}</ul>
        </nav>
        <nav aria-label="Account" className="mt-3 border-t border-white/10 pt-3">
          <ul className="space-y-1">{account.map((l) => item(l.href, l.label))}</ul>
        </nav>
      </div>
    </>
  );
}
