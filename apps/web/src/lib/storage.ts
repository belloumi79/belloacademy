/**
 * Stockage de fichiers.
 *
 * Deux pilotes interchangeables :
 *  - `local` : système de fichiers local (développement, auto-hébergement simple).
 *    Les fichiers ne sont **jamais** servis directement par un serveur statique :
 *    ils passent par une route API qui vérifie les droits d'accès.
 *  - `s3` : tout stockage compatible S3 (MinIO, Garage, AWS S3, Scaleway…).
 *    Les opérations serveur utilisent des URL présignées (SigV4), ce qui évite
 *    d'embarquer un SDK lourd et garde les secrets côté serveur.
 *
 * Aucun nom de fichier fourni par l'utilisateur n'est utilisé tel quel : la clé
 * d'objet est construite par `buildObjectKey` (cloisonnée par organisation).
 */

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

import { env } from "@/env";
import { AppError, badRequest, internal } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  buildObjectKey,
  isS3ConfigComplete,
  presignS3Url,
  sanitizeFilename,
  type S3SigningConfig,
} from "@belloacademy/shared";

export type StorageCategory = "courses" | "lessons" | "avatars" | "submissions" | "certificates" | "org-assets";

export type PutObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type StoredObject = {
  body: Uint8Array;
  contentType: string | null;
  sizeBytes: number;
};

export type StorageDriver = {
  readonly kind: "local" | "s3";
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  deleteObject(key: string): Promise<void>;
  /** URL de téléchargement directe (S3 uniquement) ; `null` si non supporté. */
  presignGet(key: string, options?: { filename?: string; expiresInSeconds?: number }): Promise<string | null>;
  /** URL de dépôt direct (S3 uniquement) ; `null` si non supporté. */
  presignPut(key: string, contentType: string, expiresInSeconds?: number): Promise<string | null>;
};

function localStorageRoot(): string {
  return resolve(/* turbopackIgnore: true */ process.cwd(), env().STORAGE_LOCAL_ROOT);
}

/** Empêche toute évasion du répertoire racine (path traversal). */
function safeLocalPath(root: string, key: string): string {
  const target = normalize(join(root, key));
  if (!target.startsWith(root + sep) && target !== root) {
    throw badRequest("Clé de stockage invalide.");
  }
  return target;
}

class LocalStorageDriver implements StorageDriver {
  readonly kind = "local" as const;

  async putObject(input: PutObjectInput): Promise<void> {
    const target = safeLocalPath(localStorageRoot(), input.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body);
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const target = safeLocalPath(localStorageRoot(), key);
    try {
      const info = await stat(target);
      if (!info.isFile()) return null;
      const body = await readFile(target);
      return { body: new Uint8Array(body), contentType: null, sizeBytes: info.size };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const target = safeLocalPath(localStorageRoot(), key);
    await rm(target, { force: true });
  }

  async presignGet(): Promise<string | null> {
    return null;
  }

  async presignPut(): Promise<string | null> {
    return null;
  }
}

class S3StorageDriver implements StorageDriver {
  readonly kind = "s3" as const;

  constructor(private readonly config: S3SigningConfig) {}

  async putObject(input: PutObjectInput): Promise<void> {
    const url = await this.sign("PUT", input.key, 900, input.contentType);
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": input.contentType },
      body: new Uint8Array(input.body) as unknown as BodyInit,
    });
    if (!response.ok) {
      logger.error("échec d'envoi vers S3", { key: input.key, status: response.status });
      throw internal("Échec de l'enregistrement du fichier.");
    }
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const url = await this.sign("GET", key, 300);
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw internal("Échec de lecture du fichier.");
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      body: buffer,
      contentType: response.headers.get("content-type"),
      sizeBytes: buffer.byteLength,
    };
  }

  async deleteObject(key: string): Promise<void> {
    const url = await this.sign("DELETE", key, 300);
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      logger.warn("échec de suppression S3", { key, status: response.status });
    }
  }

  async presignGet(key: string, options: { filename?: string; expiresInSeconds?: number } = {}): Promise<string> {
    return this.sign("GET", key, options.expiresInSeconds ?? 300, undefined, options.filename);
  }

  async presignPut(key: string, contentType: string, expiresInSeconds = 900): Promise<string> {
    return this.sign("PUT", key, expiresInSeconds, contentType);
  }

  private async sign(
    method: "GET" | "PUT" | "DELETE",
    key: string,
    expiresInSeconds: number,
    contentType?: string,
    downloadFilename?: string,
  ): Promise<string> {
    const presigned = await presignS3Url(this.config, {
      method,
      key,
      expiresInSeconds,
      ...(contentType ? { contentType } : {}),
      ...(downloadFilename ? { responseContentDisposition: `attachment; filename="${downloadFilename}"` } : {}),
    });
    return presigned.url;
  }
}

function s3ConfigFromEnv(): S3SigningConfig | null {
  const current = env();
  const candidate: Partial<S3SigningConfig> = {
    endpoint: current.S3_ENDPOINT ?? "",
    region: current.S3_REGION,
    bucket: current.S3_BUCKET ?? "",
    accessKeyId: current.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: current.S3_SECRET_ACCESS_KEY ?? "",
    forcePathStyle: current.S3_FORCE_PATH_STYLE,
  };
  return isS3ConfigComplete(candidate) ? candidate : null;
}

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const driver = env().STORAGE_DRIVER;

  if (driver === "s3") {
    const config = s3ConfigFromEnv();
    if (!config) {
      throw internal("STORAGE_DRIVER=s3 mais la configuration S3 est incomplète.");
    }
    cached = new S3StorageDriver(config);
    return cached;
  }

  cached = new LocalStorageDriver();
  return cached;
}

/** Réinitialise le pilote (tests). */
export function resetStorage(): void {
  cached = null;
}

export type NewObjectKeyInput = {
  organizationId: string;
  category: StorageCategory;
  filename: string;
  uuid: string;
};

export function newObjectKey(input: NewObjectKeyInput): string {
  return buildObjectKey({
    organizationId: input.organizationId,
    category: input.category,
    filename: input.filename,
    uuid: input.uuid,
  });
}

/** Clé de stockage des certificats générés (déterministe, régénérable). */
export function certificateObjectKey(organizationId: string, serial: string): string {
  return `org/${organizationId.replace(/[^a-zA-Z0-9-]/g, "")}/certificates/${sanitizeFilename(serial)}.pdf`;
}

export { sanitizeFilename };
