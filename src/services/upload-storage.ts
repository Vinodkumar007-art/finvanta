import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

export interface UploadStorageConfig {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

let client: S3Client | null = null;
let bucketSetup: Promise<void> | null = null;

export function getUploadStorageConfig(): UploadStorageConfig | null {
  const bucket = process.env.UPLOADS_S3_BUCKET?.trim();
  if (!bucket) return null;
  const accessKeyId = process.env.UPLOADS_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.UPLOADS_S3_SECRET_ACCESS_KEY?.trim();
  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) return null;
  return {
    bucket,
    endpoint: process.env.UPLOADS_S3_ENDPOINT?.trim() || undefined,
    region: process.env.UPLOADS_S3_REGION?.trim() || "us-east-1",
    accessKeyId,
    secretAccessKey,
  };
}

function getClient(config: UploadStorageConfig): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: Boolean(config.endpoint),
      credentials: config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    });
  }
  return client;
}

async function ensureDevelopmentBucket(config: UploadStorageConfig, s3: S3Client): Promise<void> {
  if (!config.endpoint || process.env.UPLOADS_S3_CREATE_BUCKET !== "true") return;
  if (!bucketSetup) {
    bucketSetup = (async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
      } catch (error) {
        if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404) throw error;
        await s3.send(new CreateBucketCommand({ Bucket: config.bucket }));
      }
    })();
  }
  await bucketSetup;
}

async function readyStorage() {
  const config = getUploadStorageConfig();
  if (!config) throw new Error("S3-compatible upload storage is not configured.");
  const s3 = getClient(config);
  await ensureDevelopmentBucket(config, s3);
  return { config, s3 };
}

export async function putUploadObject(key: string, body: Readable | Uint8Array, contentType: string, contentLength: number): Promise<void> {
  const { config, s3 } = await readyStorage();
  await s3.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentLength: contentLength,
    ContentType: contentType,
    CacheControl: "private, no-store",
    ServerSideEncryption: process.env.UPLOADS_S3_SSE === "true" ? "AES256" : undefined,
  }));
}

export async function deleteUploadObject(key: string): Promise<void> {
  const { config, s3 } = await readyStorage();
  await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

export async function getUploadObjectBytes(key: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("A positive safe byte limit is required to read a storage object.");
  }
  const { config, s3 } = await readyStorage();
  const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!result.Body) throw new Error("The requested storage object has no body.");
  if (result.ContentLength === undefined || result.ContentLength > maxBytes) {
    throw new Error("The requested storage object exceeds its byte limit.");
  }
  const bytes = await result.Body.transformToByteArray();
  if (bytes.byteLength > maxBytes) throw new Error("The requested storage object exceeds its byte limit.");
  return Buffer.from(bytes);
}

export async function listUploadObjectPage(continuationToken?: string) {
  const { config, s3 } = await readyStorage();
  const result = await s3.send(new ListObjectsV2Command({
    Bucket: config.bucket,
    Prefix: "uploads/",
    MaxKeys: 500,
    ContinuationToken: continuationToken,
  }));
  return {
    objects: (result.Contents ?? []).flatMap((object) => object.Key
      ? [{ key: object.Key, lastModified: object.LastModified }]
      : []),
    continuationToken: result.NextContinuationToken,
  };
}

export async function createUploadReadUrl(key: string, contentType: string, filename: string, inline = false): Promise<string> {
  const { config, s3 } = await readyStorage();
  const safeName = filename.replace(/["\\\r\n]/g, "_");
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ResponseContentType: contentType,
    ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
  }), { expiresIn: 300 });
}
