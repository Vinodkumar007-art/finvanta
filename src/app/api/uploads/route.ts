import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform, type Readable as NodeReadable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import sharp from "sharp";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { can, type CompanyCtx } from "@/lib/ctx";
import { rateLimit } from "@/lib/ratelimit";
import { AntivirusUnavailableError, isAntivirusConfigured, MalwareDetectedError, scanUploadWithClamAv } from "@/services/upload-antivirus";
import { createUploadReadUrl, deleteUploadObject, getUploadStorageConfig, putUploadObject } from "@/services/upload-storage";
import {
  detectUploadMime,
  isValidDocxPackage,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  sanitizeOriginalName,
  type UploadMime,
} from "@/services/upload-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = MAX_UPLOAD_FILE_BYTES * MAX_UPLOAD_FILES + 1024 * 1024;
const STORAGE_PREFIX = "s3://";

interface StagedUpload {
  filename: string;
  path: string;
  size: number;
  sha256: string;
  mime: UploadMime | null;
  error?: string;
}

class RequestSizeLimitError extends Error {}

function stageFile(stream: NodeReadable & { truncated?: boolean }, filename: string, tempPath: string): Promise<StagedUpload> {
  let size = 0;
  let prefix = Buffer.alloc(0);
  let mime: UploadMime | null = null;
  let validationError: string | undefined;
  const hash = createHash("sha256");

  const inspector = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_UPLOAD_FILE_BYTES) {
        validationError = "File exceeds the 10 MB per-file limit.";
        callback();
        return;
      }
      if (validationError) {
        callback();
        return;
      }
      hash.update(chunk);
      if (!mime) {
        const needed = 16 - prefix.length;
        const head = chunk.subarray(0, needed);
        prefix = Buffer.concat([prefix, head]);
        if (prefix.length < 16) {
          callback();
          return;
        }
        mime = detectUploadMime(prefix);
        if (!mime) {
          validationError = "Unsupported or invalid file content.";
          callback();
          return;
        }
        this.push(prefix);
        const remainder = chunk.subarray(needed);
        if (remainder.length) this.push(remainder);
        callback();
        return;
      }
      this.push(chunk);
      callback();
    },
    flush(callback) {
      if (!validationError && !mime) {
        mime = detectUploadMime(prefix);
        if (!mime) validationError = "Unsupported or invalid file content.";
        else this.push(prefix);
      }
      callback();
    },
  });

  return pipeline(stream, inspector, createWriteStream(tempPath, { flags: "wx" })).then(
    () => ({
      filename,
      path: tempPath,
      size,
      sha256: hash.digest("hex"),
      mime,
      ...(stream.truncated ? { error: "File exceeds the 10 MB per-file limit." } : {}),
      ...(validationError ? { error: validationError } : {}),
    }),
    (error: unknown) => ({
      filename,
      path: tempPath,
      size,
      sha256: "",
      mime: null,
      error: error instanceof Error ? error.message : "Could not read the file stream.",
    }),
  );
}

async function stageRequest(request: Request, tempPaths: string[]): Promise<StagedUpload[]> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new Error("Send files as multipart form data.");
  if (!request.body) throw new Error("The upload request has no body.");
  const statedLength = Number(request.headers.get("content-length") ?? 0);
  if (statedLength > MAX_REQUEST_BYTES) throw new RequestSizeLimitError("The upload request is too large.");

  const parser = Busboy({
    headers: { "content-type": contentType },
    limits: {
      files: MAX_UPLOAD_FILES + 1,
      fileSize: MAX_UPLOAD_FILE_BYTES + 1,
      parts: MAX_UPLOAD_FILES + 1,
      fields: 0,
      fieldSize: 0,
      headerPairs: 100,
    },
  });
  const staged: Promise<StagedUpload>[] = [];
  let tooManyFiles = false;
  let unsupportedParts = false;
  let requestBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      requestBytes += chunk.length;
      if (requestBytes > MAX_REQUEST_BYTES) callback(new RequestSizeLimitError("The upload request is too large."));
      else callback(null, chunk);
    },
  });

  parser.on("file", (_fieldName, stream, info) => {
    if (staged.length >= MAX_UPLOAD_FILES) {
      tooManyFiles = true;
      stream.resume();
      return;
    }
    const filename = info.filename ?? "";
    const tempPath = path.join(os.tmpdir(), `finvanta-upload-${randomUUID()}`);
    tempPaths.push(tempPath);
    staged.push(stageFile(stream, filename, tempPath));
  });
  parser.on("filesLimit", () => { tooManyFiles = true; });
  parser.on("partsLimit", () => { unsupportedParts = true; });
  parser.on("fieldsLimit", () => { unsupportedParts = true; });

  try {
    const body = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream<Uint8Array>);
    await pipeline(body, limiter, parser);
  } catch (error) {
    await Promise.all(staged);
    if (error instanceof RequestSizeLimitError) throw error;
    throw new Error("The multipart upload could not be parsed.");
  }
  const files = await Promise.all(staged);
  if (tooManyFiles) throw new Error(`Upload no more than ${MAX_UPLOAD_FILES} files per request.`);
  if (unsupportedParts) throw new Error("Only file parts are allowed in the upload request.");
  return files;
}

function failure(filename: string, message: string) {
  return { filename: sanitizeOriginalName(filename), status: "rejected" as const, error: message };
}

async function processFile(file: StagedUpload, ctx: CompanyCtx) {
  const filename = sanitizeOriginalName(file.filename);
  if (file.error || !file.mime || !file.size) return failure(file.filename, file.error ?? "The file is empty or has an unsupported type.");

  if (file.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && !(await isValidDocxPackage(file.path))) {
    return failure(file.filename, "The file is not a valid Word document.");
  }

  try {
    await scanUploadWithClamAv(file.path);
  } catch (error) {
    if (error instanceof MalwareDetectedError) return failure(file.filename, error.message);
    if (error instanceof AntivirusUnavailableError) return failure(file.filename, "Antivirus scanning is unavailable; no file was stored.");
    console.error("[finvanta] upload antivirus scan failed", error);
    return failure(file.filename, "Antivirus scanning failed; no file was stored.");
  }

  const id = randomUUID();
  const originalKey = `uploads/${ctx.org.id}/${id}/original`;
  const thumbnailKey = `uploads/${ctx.org.id}/${id}/thumbnail.webp`;
  const objectKeys: string[] = [];
  let databaseCommitted = false;

  try {
    const [duplicate] = await db.select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(and(eq(documents.companyId, ctx.company.id), eq(documents.sha256, file.sha256), isNull(documents.deletedAt)))
      .limit(1);
    if (duplicate) return failure(file.filename, `An identical file is already stored as “${duplicate.name}”.`);

    let thumbnail: Buffer | null = null;
    if (file.mime.startsWith("image/")) {
      thumbnail = await sharp(file.path, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
    }

    objectKeys.push(originalKey);
    await putUploadObject(originalKey, createReadStream(file.path), file.mime, file.size);
    if (thumbnail) {
      objectKeys.push(thumbnailKey);
      await putUploadObject(thumbnailKey, thumbnail, "image/webp", thumbnail.byteLength);
    }

    const url = await createUploadReadUrl(originalKey, file.mime, filename);
    const thumbnailUrl = thumbnail ? await createUploadReadUrl(thumbnailKey, "image/webp", `${filename}.webp`, true) : undefined;
    await db.insert(documents).values({
      id,
      orgId: ctx.org.id,
      companyId: ctx.company.id,
      name: filename,
      mime: file.mime,
      size: file.size,
      sha256: file.sha256,
      storagePath: `${STORAGE_PREFIX}${originalKey}`,
      docType: "uploaded",
      status: "uploaded",
      createdBy: ctx.user.id,
    });
    databaseCommitted = true;

    return {
      id,
      filename,
      status: "uploaded" as const,
      mime: file.mime,
      size: file.size,
      checksum: file.sha256,
      url,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    };
  } catch (error) {
    if (!databaseCommitted) {
      const cleanup = await Promise.allSettled(objectKeys.map(deleteUploadObject));
      for (const result of cleanup) {
        if (result.status === "rejected") console.error("[finvanta] upload object cleanup failed", result.reason);
      }
    }
    console.error("[finvanta] upload processing failed", error);
    return failure(file.filename, databaseCommitted ? "The file was stored, but a follow-up step failed." : "The file could not be stored.");
  }
}

export async function POST(request: Request) {
  const auth = await apiCtx(request, { mutate: true, needCompany: true });
  if ("error" in auth) return auth.error;
  if (!can(auth.ctx.role, "write")) return json({ error: "Your role cannot upload files." }, 403);
  if (!rateLimit(`file-upload:${auth.ctx.user.id}`, 20, 600_000).ok) return json({ error: "Too many uploads; try again later." }, 429);
  if (!getUploadStorageConfig()) return json({ error: "S3-compatible upload storage is not configured." }, 503);
  if (!isAntivirusConfigured()) return json({ error: "Antivirus scanning is not configured." }, 503);

  const tempPaths: string[] = [];
  try {
    const files = await stageRequest(request, tempPaths);
    if (!files.length) return json({ error: "Choose at least one file." }, 400);
    const results = await Promise.all(files.map((file) => processFile(file, auth.ctx)));
    const failed = results.filter((result) => result.status === "rejected").length;
    return json({ results }, failed ? 207 : 201);
  } catch (error) {
    if (error instanceof RequestSizeLimitError) return json({ error: error.message }, 413);
    return json({ error: error instanceof Error ? error.message : "The upload request could not be processed." }, 400);
  } finally {
    const cleanup = await Promise.allSettled(tempPaths.map((tempPath) => rm(tempPath, { force: true })));
    for (const result of cleanup) {
      if (result.status === "rejected") console.error("[finvanta] temporary upload cleanup failed", result.reason);
    }
  }
}
