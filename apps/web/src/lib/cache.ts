/**
 * Cache / compteurs partagés.
 *
 * Redis (ou Valkey, protocole compatible) est utilisé lorsqu'il est configuré
 * (`REDIS_URL`). Sinon, un stockage en mémoire suffit pour le développement et
 * les tests mono-processus — avec les limites documentées dans docs/ARCHITECTURE.md
 * (les compteurs ne sont pas partagés entre instances).
 */

import { env } from "@/env";
import { logger } from "@/lib/logger";

export type CacheStore = {
  readonly kind: "redis" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Incrémente un compteur et renvoie sa valeur. Le TTL est posé à la création. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** Durée de vie restante en secondes (0 si absente). */
  ttl(key: string): Promise<number>;
  close(): Promise<void>;
};

type MemoryEntry = { value: string; expiresAt: number | null };

class MemoryCacheStore implements CacheStore {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, MemoryEntry>();

  private read(key: string): MemoryEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.read(key);
    if (!entry) {
      await this.set(key, "1", ttlSeconds);
      return 1;
    }
    const next = Number.parseInt(entry.value, 10) + 1;
    this.entries.set(key, { value: String(next), expiresAt: entry.expiresAt });
    return next;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.read(key);
    if (!entry || entry.expiresAt === null) return 0;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  async close(): Promise<void> {
    this.entries.clear();
  }
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, ttl: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  quit(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

class RedisCacheStore implements CacheStore {
  readonly kind = "redis" as const;

  constructor(private readonly client: RedisLike) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.client.set(key, value, "EX", ttlSeconds);
    else await this.client.set(key, value, "EX", 60 * 60 * 24 * 365);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.client.incr(key);
    if (value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async ttl(key: string): Promise<number> {
    const value = await this.client.ttl(key);
    return value > 0 ? value : 0;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

let store: CacheStore | null = null;

export async function getCacheStore(): Promise<CacheStore> {
  if (store) return store;

  const url = env().REDIS_URL;
  if (!url) {
    store = new MemoryCacheStore();
    return store;
  }

  try {
    const { default: Redis } = (await import("ioredis")) as unknown as {
      default: new (url: string, options?: Record<string, unknown>) => RedisLike;
    };
    const client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false });
    client.on("error", (error: unknown) => logger.warn("Redis indisponible", { error }));
    store = new RedisCacheStore(client);
    logger.info("Cache partagé initialisé (Redis)", { url: url.replace(/\/\/.*@/, "//***@") });
    return store;
  } catch (error) {
    logger.warn("Impossible d'initialiser Redis, repli sur le cache mémoire", { error });
    store = new MemoryCacheStore();
    return store;
  }
}

/** Réinitialise le cache (tests). */
export function resetCacheStore(): void {
  store = null;
}

export { MemoryCacheStore };
