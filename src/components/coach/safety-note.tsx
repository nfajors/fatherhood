import { CRISIS_RESOURCES } from "@/lib/coach/policy";

/** Always on the coach pages, so help never depends on what the AI says. */
export function SafetyNote() {
  return (
    <details className="rounded-lg border border-navy-900/10 bg-white px-4 py-3 text-sm">
      <summary className="cursor-pointer text-muted">
        The coach is an AI, not a therapist, doctor or lawyer. <span className="font-semibold text-navy-900">Need help now?</span>
      </summary>
      <ul className="mt-3 space-y-2">
        {CRISIS_RESOURCES.map((r) => (
          <li key={r.name}>
            <strong>{r.name}:</strong> {r.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}
