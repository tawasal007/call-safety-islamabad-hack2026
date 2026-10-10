import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, put } from "@vercel/blob";

/**
 * Minimal JSON document store for monitoring data (warnings, events, alerts).
 * One document per item so concurrent serverless writers never overwrite
 * each other's records. Raw audio is never stored here.
 */
export interface DocStore {
  put(key: string, value: unknown): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  list<T>(prefix: string): Promise<T[]>;
}

const DOC_KEY = /^call-[0-9a-f-]{36}(?:\/[A-Za-z0-9_.-]+)+\.json$/;
const PREFIX_KEY = /^call-[0-9a-f-]{36}(?:\/[A-Za-z0-9_-]+)+$/;

function checkDoc(key: string) {
  if (!DOC_KEY.test(key) || key.includes("..")) throw new Error("Invalid storage key");
}

function checkPrefix(prefix: string) {
  if (!PREFIX_KEY.test(prefix)) throw new Error("Invalid storage prefix");
}

/** Local development store under data/call-logs/ (git-ignored). */
export function localStore(root: string): DocStore {
  const resolve = (key: string) => path.join(root, ...key.split("/"));
  return {
    async put(key, value) {
      checkDoc(key);
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(value), "utf8");
      await rename(temporary, file);
    },
    async get<T>(key: string) {
      checkDoc(key);
      try { return JSON.parse(await readFile(resolve(key), "utf8")) as T; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async list<T>(prefix: string) {
      checkPrefix(prefix);
      let names: string[];
      try { names = await readdir(resolve(prefix)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const docs = await Promise.all(names.filter((name) => name.endsWith(".json")).sort()
        .map(async (name) => JSON.parse(await readFile(path.join(resolve(prefix), name), "utf8")) as T));
      return docs;
    },
  };
}

/** Production store: private Vercel Blob objects under call-logs/<room>/monitoring/. */
export function blobStore(namespace = "call-logs"): DocStore {
  const pathname = (key: string) => `${namespace}/${key}`;
  const read = async <T>(name: string): Promise<T | null> => {
    const result = await get(name, { access: "private", useCache: false });
    if (!result?.stream) return null;
    return await new Response(result.stream).json() as T;
  };
  return {
    async put(key, value) {
      checkDoc(key);
      await put(pathname(key), JSON.stringify(value), {
        access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json",
      });
    },
    async get<T>(key: string) {
      checkDoc(key);
      return read<T>(pathname(key));
    },
    async list<T>(prefix: string) {
      checkPrefix(prefix);
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: `${pathname(prefix)}/`, cursor, limit: 1000 });
        names.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      const docs = await Promise.all(names.sort().map((name) => read<T>(name)));
      return docs.filter((doc): doc is Awaited<T> => doc !== null) as T[];
    },
  };
}

export function defaultStore(): DocStore {
  if (process.env.VERCEL) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Private monitoring storage is not configured.");
    return blobStore();
  }
  return localStore(path.join(process.cwd(), "data", "call-logs"));
}