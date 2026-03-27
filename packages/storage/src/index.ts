import { createReadStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import { Storage } from "@google-cloud/storage";

export const acceptedImageContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const maxInventoryImageBytes = 10 * 1024 * 1024;

type StorageBackend = "local" | "gcs";

type UploadInventoryImageInput = {
  workspaceId: string;
  inventoryItemId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
  publicBaseUrl: string;
};

export type UploadedObject = {
  url: string;
  storageKey: string;
  contentType: string;
  size: number;
};

export type DeleteStoredObjectResult = {
  managed: boolean;
  deleted: boolean;
};

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveStorageBackend(): StorageBackend {
  const explicit = process.env.STORAGE_BACKEND?.trim().toLowerCase();

  if (explicit === "gcs" || explicit === "local") {
    return explicit;
  }

  return process.env.NODE_ENV === "production" ? "gcs" : "local";
}

function buildStorageKey(workspaceId: string, inventoryItemId: string, filename: string, contentType: string) {
  const extension = resolveFileExtension(filename, contentType);
  return [
    "workspaces",
    sanitizeSegment(workspaceId),
    "inventory",
    sanitizeSegment(inventoryItemId),
    `${crypto.randomUUID()}${extension}`
  ].join("/");
}

function resolveFileExtension(filename: string, contentType: string) {
  const explicit = path.extname(filename).toLowerCase();

  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(explicit)) {
    return explicit === ".jpeg" ? ".jpg" : explicit;
  }

  switch (contentType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".bin";
  }
}

function resolveLocalBaseDir() {
  return path.resolve(process.cwd(), process.env.LOCAL_UPLOAD_BASE_DIR ?? "tmp/uploads");
}

function encodeStorageKeyForUrl(storageKey: string) {
  return storageKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeStorageKeyFromUrlPath(pathname: string) {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

export function inferContentTypeFromStorageKey(storageKey: string) {
  const extension = path.extname(storageKey).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export function resolveLocalUploadPath(storageKey: string) {
  const baseDir = resolveLocalBaseDir();
  const resolved = path.resolve(baseDir, storageKey);

  if (!resolved.startsWith(baseDir)) {
    return null;
  }

  return resolved;
}

export function openLocalUploadStream(storageKey: string) {
  const resolved = resolveLocalUploadPath(storageKey);

  if (!resolved) {
    return null;
  }

  return createReadStream(resolved);
}

export async function localUploadExists(storageKey: string) {
  const resolved = resolveLocalUploadPath(storageKey);

  if (!resolved) {
    return false;
  }

  try {
    await access(resolved);
    return true;
  } catch {
    return false;
  }
}

async function gcsUploadExists(storageKey: string) {
  const bucketName = process.env.GCS_BUCKET_UPLOADS;

  if (!bucketName) {
    return false;
  }

  const storage = new Storage();
  const [exists] = await storage.bucket(bucketName).file(storageKey).exists();
  return exists;
}

function openGcsUploadStream(storageKey: string): Readable | null {
  const bucketName = process.env.GCS_BUCKET_UPLOADS;

  if (!bucketName) {
    return null;
  }

  const storage = new Storage();
  return storage.bucket(bucketName).file(storageKey).createReadStream();
}

async function deleteLocalUpload(storageKey: string) {
  const resolved = resolveLocalUploadPath(storageKey);

  if (!resolved) {
    return false;
  }

  try {
    await unlink(resolved);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function uploadToLocalStorage(input: UploadInventoryImageInput): Promise<UploadedObject> {
  const storageKey = buildStorageKey(input.workspaceId, input.inventoryItemId, input.filename, input.contentType);
  const filePath = resolveLocalUploadPath(storageKey);

  if (!filePath) {
    throw new Error("Could not resolve local upload path");
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.buffer);

  return {
    url: `${input.publicBaseUrl}/api/uploads/${encodeStorageKeyForUrl(storageKey)}`,
    storageKey,
    contentType: input.contentType,
    size: input.buffer.byteLength
  };
}

async function uploadToGcs(input: UploadInventoryImageInput): Promise<UploadedObject> {
  const bucketName = process.env.GCS_BUCKET_UPLOADS;

  if (!bucketName) {
    throw new Error("GCS_BUCKET_UPLOADS is required for GCS uploads");
  }

  const storageKey = buildStorageKey(input.workspaceId, input.inventoryItemId, input.filename, input.contentType);
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(storageKey);

  await file.save(input.buffer, {
    resumable: false,
    contentType: input.contentType,
    metadata: {
      cacheControl: "public, max-age=31536000, immutable"
    }
  });

  const publicBaseUrl = process.env.GCS_UPLOAD_PUBLIC_BASE_URL?.trim()?.replace(/\/$/, "");
  const useApiProxy = !publicBaseUrl || !publicBaseUrl.includes("storage.googleapis.com");

  return {
    url: useApiProxy
      ? `${(publicBaseUrl ?? input.publicBaseUrl).replace(/\/$/, "")}/api/uploads/${encodeStorageKeyForUrl(storageKey)}`
      : `${publicBaseUrl}/${encodeStorageKeyForUrl(storageKey)}`,
    storageKey,
    contentType: input.contentType,
    size: input.buffer.byteLength
  };
}

function extractManagedStorageKey(url: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (parsedUrl.pathname.startsWith("/api/uploads/")) {
    return {
      backend: "local" as const,
      storageKey: decodeStorageKeyFromUrlPath(parsedUrl.pathname.replace(/^\/api\/uploads\//, ""))
    };
  }

  const configuredPublicBase = process.env.GCS_UPLOAD_PUBLIC_BASE_URL?.trim()?.replace(/\/$/, "");

  if (configuredPublicBase) {
    const configuredUrl = new URL(configuredPublicBase);

    if (parsedUrl.origin === configuredUrl.origin && parsedUrl.pathname.startsWith(configuredUrl.pathname.replace(/\/$/, "") + "/")) {
      return {
        backend: "gcs" as const,
        storageKey: decodeStorageKeyFromUrlPath(
          parsedUrl.pathname.replace(new RegExp(`^${configuredUrl.pathname.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\/$/, "")}/`), "")
        )
      };
    }
  }

  const bucketName = process.env.GCS_BUCKET_UPLOADS?.trim();

  if (
    bucketName &&
    parsedUrl.hostname === "storage.googleapis.com" &&
    parsedUrl.pathname.startsWith(`/${bucketName}/`)
  ) {
    return {
      backend: "gcs" as const,
      storageKey: decodeStorageKeyFromUrlPath(parsedUrl.pathname.replace(`/${bucketName}/`, ""))
    };
  }

  return null;
}

async function deleteGcsUpload(storageKey: string) {
  const bucketName = process.env.GCS_BUCKET_UPLOADS;

  if (!bucketName) {
    throw new Error("GCS_BUCKET_UPLOADS is required for GCS deletes");
  }

  const storage = new Storage();
  const file = storage.bucket(bucketName).file(storageKey);

  try {
    await file.delete();
    return true;
  } catch (error) {
    const deleteError = error as { code?: number };

    if (deleteError.code === 404) {
      return false;
    }

    throw error;
  }
}

export async function uploadInventoryImage(input: UploadInventoryImageInput) {
  if (!acceptedImageContentTypes.has(input.contentType)) {
    throw new Error(`Unsupported image type: ${input.contentType}`);
  }

  if (input.buffer.byteLength > maxInventoryImageBytes) {
    throw new Error(`Image exceeds ${maxInventoryImageBytes} bytes`);
  }

  const backend = resolveStorageBackend();

  return backend === "gcs" ? uploadToGcs(input) : uploadToLocalStorage(input);
}

export async function managedUploadExists(storageKey: string) {
  const backend = resolveStorageBackend();
  return backend === "gcs" ? gcsUploadExists(storageKey) : localUploadExists(storageKey);
}

export function openManagedUploadStream(storageKey: string) {
  const backend = resolveStorageBackend();
  return backend === "gcs" ? openGcsUploadStream(storageKey) : openLocalUploadStream(storageKey);
}

export async function deleteManagedInventoryImage(url: string): Promise<DeleteStoredObjectResult> {
  const managed = extractManagedStorageKey(url);

  if (!managed) {
    return {
      managed: false,
      deleted: false
    };
  }

  const deleted =
    managed.backend === "gcs" ? await deleteGcsUpload(managed.storageKey) : await deleteLocalUpload(managed.storageKey);

  return {
    managed: true,
    deleted
  };
}
