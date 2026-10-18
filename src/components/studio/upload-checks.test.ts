import { describe, expect, it } from "vitest";
import { fileProblem, formatBytes, uploadErrorMessage } from "./upload-checks";

const mp4 = (size = 10_000_000) => ({ size, type: "video/mp4" });
const response = (status: number, body: string) => ({ originalResponse: { getStatus: () => status, getBody: () => body } });

describe("fileProblem", () => {
  it("accepts a short video, and an unknown duration", () => {
    expect(fileProblem(mp4(), 479, "community")).toBeNull();
    expect(fileProblem(mp4(), null, "community")).toBeNull();
    expect(fileProblem({ size: 1, type: "" }, null, "community")).toBeNull(); // some phones give no type
  });

  it("refuses Community videos over 8 minutes, but not lessons", () => {
    expect(fileProblem(mp4(), 545, "community")).toMatch(/9:05 long.*up to 8 minutes/);
    expect(fileProblem(mp4(), 3000, "professional")).toBeNull();
  });

  it("refuses non-videos and oversized files", () => {
    expect(fileProblem({ size: 1, type: "image/png" }, null, "community")).toMatch(/isn't a video/);
    expect(fileProblem(mp4(6 * 1024 ** 3), 60, "community")).toMatch(/over 5 GB/);
  });
});

describe("uploadErrorMessage", () => {
  it("uses the server's message, then falls back by status", () => {
    expect(uploadErrorMessage(response(409, JSON.stringify({ message: "This video's file can't be replaced now." })))).toBe("This video's file can't be replaced now.");
    expect(uploadErrorMessage(response(401, "{}"))).toMatch(/Sign in again/);
    expect(uploadErrorMessage(new Error("network"))).toMatch(/picks up where it left off/);
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5.25 * 1024 ** 2)).toBe("5.3 MB");
    expect(formatBytes(640 * 1024 ** 2)).toBe("640 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});
