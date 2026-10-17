import { getDb } from "@/lib/db";
import { themeClassifierConfigured } from "@/lib/env";
import { ClaudeThemeClassifier, type ThemeClassifier } from "./classifier";
import { assignThemes, type ThemeTarget } from "./service";

let classifier: ThemeClassifier | undefined;

/** The production classifier, or null when no Anthropic credentials are configured. */
export function getThemeClassifier(): ThemeClassifier | null {
  if (!themeClassifierConfigured()) return null;
  classifier ??= new ClaudeThemeClassifier();
  return classifier;
}

/**
 * Theme content in the background (after a response is sent). Failures are
 * logged, not thrown: the item stays unthemed and the admin tool shows it.
 */
export async function themeInBackground(target: ThemeTarget): Promise<void> {
  const active = getThemeClassifier();
  if (!active) return;
  try {
    await assignThemes(getDb(), target, active);
  } catch (error) {
    console.error(`Theme classification failed for ${target.kind} ${target.id}:`, error);
  }
}
