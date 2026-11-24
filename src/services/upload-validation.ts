import yauzl from "yauzl";

export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 5;

export type UploadMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function detectUploadMime(head: Buffer): UploadMime | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (head.length >= 5 && head.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

export function sanitizeOriginalName(filename: string): string {
  const leaf = filename.replace(/[\\/]/g, "/").split("/").pop() ?? "";
  const safe = leaf.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (safe || "upload").slice(0, 200);
}

export function isValidDocxPackage(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true, decodeStrings: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) {
        resolve(false);
        return;
      }

      const names = new Set<string>();
      let entries = 0;
      let expandedBytes = 0;
      let complete = false;
      const finish = (valid: boolean) => {
        if (complete) return;
        complete = true;
        resolve(valid);
        zip.close();
      };

      zip.on("error", () => finish(false));
      zip.on("end", () => finish(names.has("[Content_Types].xml") && names.has("word/document.xml")));
      zip.on("entry", (entry) => {
        entries += 1;
        expandedBytes += entry.uncompressedSize;
        const safeName = yauzl.validateFileName(entry.fileName) === null;
        const duplicate = names.has(entry.fileName);
        if (
          !safeName ||
          duplicate ||
          entry.isEncrypted() ||
          !entry.canDecodeFileData() ||
          entries > 1000 ||
          entry.uncompressedSize > 50 * 1024 * 1024 ||
          expandedBytes > 100 * 1024 * 1024
        ) {
          finish(false);
          return;
        }
        names.add(entry.fileName);
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
}
