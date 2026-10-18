import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Requirements } from "@/lib/learning/certificates";

/** Course page: how to earn the certificate, progress toward it, or a link to it. */
export function CertificateBox({ certificateCode, requirements, signedIn }: {
  certificateCode: string | null;
  requirements: Requirements;
  signedIn: boolean;
}) {
  const { lessonsDone, lessonsTotal, quizzesPassed, quizzesTotal } = requirements;
  if (lessonsTotal === 0) return null;
  if (certificateCode) {
    return (
      <div className="rounded-xl border border-gold-500/40 bg-gold-100 p-5">
        <h2 className="text-lg font-semibold">
          <span aria-hidden>🎓 </span>Course complete
        </h2>
        <p className="mt-1 text-sm text-ink">You finished every lesson{quizzesTotal > 0 ? " and passed every quiz" : ""}.</p>
        <Button asChild size="sm" variant="secondary" className="mt-3">
          <Link href={`/certificates/${certificateCode}`}>View your certificate</Link>
        </Button>
      </div>
    );
  }
  const quizzes = quizzesTotal > 0 ? ` and pass its ${quizzesTotal === 1 ? "quiz" : `${quizzesTotal} quizzes`}` : "";
  return (
    <div className="rounded-xl border border-navy-900/10 bg-white p-5">
      <h2 className="text-lg font-semibold">Certificate of completion</h2>
      <p className="mt-1 text-sm text-muted">Finish every lesson{quizzes} to earn a certificate you can share or add to LinkedIn.</p>
      {signedIn && (lessonsDone > 0 || quizzesPassed > 0) && (
        <ul className="mt-3 space-y-1 text-sm">
          <li>
            <span aria-hidden className={lessonsDone >= lessonsTotal ? "text-green-700" : "text-muted"}>{lessonsDone >= lessonsTotal ? "✓ " : "○ "}</span>
            {lessonsDone} of {lessonsTotal} lessons finished
          </li>
          {quizzesTotal > 0 && (
            <li>
              <span aria-hidden className={quizzesPassed >= quizzesTotal ? "text-green-700" : "text-muted"}>{quizzesPassed >= quizzesTotal ? "✓ " : "○ "}</span>
              {quizzesPassed} of {quizzesTotal} quizzes passed
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
