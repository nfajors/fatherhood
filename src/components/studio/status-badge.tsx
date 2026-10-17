import type { VideoStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/** What each status means to the creator, with an icon so it never relies on color alone. */
export const STATUS_COPY: Record<VideoStatus, { label: string; icon: string; tone: "good" | "attention" | "bad" | "neutral"; hint: string }> = {
  uploading: { label: "Not uploaded yet", icon: "↑", tone: "attention", hint: "Choose the file to upload, or resume an upload that stopped." },
  processing: { label: "Processing", icon: "…", tone: "neutral", hint: "Cloudflare is preparing your video. This usually takes a few minutes." },
  pending_review: { label: "In review", icon: "…", tone: "neutral", hint: "Our team reviews Community videos within 48 hours." },
  approved: { label: "Published", icon: "✓", tone: "good", hint: "Live on Community Voices." },
  changes_requested: { label: "Changes requested", icon: "!", tone: "attention", hint: "See the reviewer's note, then edit and resubmit or upload a new file." },
  rejected: { label: "Not approved", icon: "✕", tone: "bad", hint: "This video can't be published." },
  unpublished: { label: "Taken down", icon: "✕", tone: "bad", hint: "This video was removed after a review." },
  failed: { label: "Upload failed", icon: "!", tone: "attention", hint: "Cloudflare couldn't process the file. Try uploading it again." },
};

const TONE = {
  good: "bg-emerald-100 text-emerald-900",
  attention: "bg-amber-100 text-amber-900",
  bad: "bg-red-100 text-red-800",
  neutral: "bg-navy-100 text-navy-900",
} as const;

export function StatusBadge({ status, className }: { status: VideoStatus; className?: string }) {
  const copy = STATUS_COPY[status];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold", TONE[copy.tone], className)}>
      <span aria-hidden>{copy.icon}</span>
      {copy.label}
    </span>
  );
}
