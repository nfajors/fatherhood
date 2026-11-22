/** Where downloads live on the phone: one MP4 per video, plus a small JSON index. */
import { Directory, File, Paths } from "expo-file-system";
import type { QueuedProgress } from "../player/progressQueue";
import type { DownloadRecord } from "./licenses";

const dir = () => new Directory(Paths.document, "downloads");

function ensureDir() {
  const d = dir();
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  const file = new File(dir(), name);
  if (!file.exists) return fallback;
  try {
    return JSON.parse(await file.text()) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(name: string, value: unknown) {
  await new File(ensureDir(), name).write(JSON.stringify(value));
}

export const loadRecords = () => readJson<DownloadRecord[]>("index.json", []);
export const saveRecords = (records: DownloadRecord[]) => writeJson("index.json", records);
export const loadQueue = () => readJson<QueuedProgress[]>("progress.json", []);
export const saveQueue = (queue: QueuedProgress[]) => writeJson("progress.json", queue);

export const videoFile = (fileName: string) => new File(ensureDir(), fileName);

export function deleteVideoFile(fileName: string) {
  const file = new File(dir(), fileName);
  if (file.exists) file.delete();
}

/** Download to a temporary name, then move into place, so a cut-off download never looks finished. */
export async function downloadVideo(url: string, fileName: string, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<number> {
  const partial = new File(ensureDir(), `${fileName}.part`);
  if (partial.exists) partial.delete();
  await File.downloadFileAsync(url, partial, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => totalBytes > 0 && onProgress(bytesWritten / totalBytes),
  });
  const final = new File(dir(), fileName);
  if (final.exists) final.delete();
  await partial.move(final);
  return final.size ?? 0;
}

/** Everything in the downloads folder (sign-out). */
export function deleteAll() {
  const d = dir();
  if (d.exists) d.delete();
}
