import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinCodeForm } from "@/components/organizations/forms";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Join with a code" };
export const dynamic = "force-dynamic";

export default async function JoinWithCodePage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/sign-up?next=/join");
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Join with your organization&apos;s code</h1>
      <p className="mt-3 text-muted">
        If your program, employer or school gave you a code, enter it to get full access to Fatherhood.School. Got an email invitation instead? Use the link in
        it.
      </p>
      <div className="mt-8">
        <JoinCodeForm />
      </div>
      <p className="mt-10 text-sm text-muted">
        Want this for your organization?{" "}
        <Link href="/for-organizations" className="underline">
          See how it works
        </Link>
        .
      </p>
    </div>
  );
}
