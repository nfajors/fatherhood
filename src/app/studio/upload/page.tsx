import type { Metadata } from "next";
import { UploadForm } from "@/components/studio/upload-form";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { RISK_CATEGORIES } from "@/lib/moderation/policy";

export const metadata: Metadata = { title: "Upload a video", robots: { index: false } };

export default async function UploadPage() {
  const sessionUser = (await getSessionUser())!;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Upload a video</h1>
      <p className="mt-2 text-muted">
        Short, honest stories and practical lessons from your own fathering. Every video is reviewed before it&apos;s published, usually
        within 48 hours.
      </p>
      <Card className="mt-8">
        <UploadForm canUploadLessons={sessionUser.role === "admin"} />
      </Card>
      <section aria-labelledby="tips" className="mt-8 text-sm text-muted">
        <h2 id="tips" className="font-semibold text-navy-900">
          What gets approved
        </h2>
        <p className="mt-2">Stories and lessons grounded in your own experience as a father. Reviewers decline videos with:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {Object.values(RISK_CATEGORIES).map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
