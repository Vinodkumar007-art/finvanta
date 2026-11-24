import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectUploadMime, isValidDocxPackage, sanitizeOriginalName } from "@/services/upload-validation";

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("upload content validation", () => {
  it("detects allowed types from file signatures and rejects unsupported payloads", () => {
    expect(detectUploadMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectUploadMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectUploadMime(Buffer.from("RIFF0000WEBP"))).toBe("image/webp");
    expect(detectUploadMime(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectUploadMime(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"))).toBeNull();
    expect(detectUploadMime(Buffer.from("PK\u0003\u0004"))).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("sanitizes path components and rejects malformed zip payloads as DOCX", async () => {
    expect(sanitizeOriginalName("..\\..\\report\r\n.pdf")).toBe("report.pdf");
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "finvanta-upload-test-"));
    const invalidZip = path.join(tempDirectory, "spoof.docx");
    await writeFile(invalidZip, Buffer.from("PK\u0003\u0004not a valid package"));
    await expect(isValidDocxPackage(invalidZip)).resolves.toBe(false);
  });
});
