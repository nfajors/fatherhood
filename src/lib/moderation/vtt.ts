/**
 * WebVTT to plain transcript text: drops the header, cue numbers, timings and
 * tags, and collapses the repeated lines that rolling captions produce.
 */
export function vttToText(vtt: string): string {
  const lines: string[] = [];
  let skippingBlock = false;
  for (const raw of vtt.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      skippingBlock = false;
      continue;
    }
    if (skippingBlock) continue;
    if (/^WEBVTT\b/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) {
      skippingBlock = true; // header and metadata blocks run until a blank line
      continue;
    }
    if (line.includes("-->") || /^\d+$/.test(line)) continue;
    const text = line.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (text && text !== lines[lines.length - 1]) lines.push(text);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}
