import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { type SavedSecret, SecretFileSchema } from "../types/index.js";
import { configPaths } from "./config.js";

const SECRETS_DIR = configPaths.secrets;

export function ensureSecretsDir(): void {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true });
  }
}

function getSecretFilePath(service: string): string {
  return join(SECRETS_DIR, `${service}.json`);
}

function readSecretFile(service: string): SavedSecret[] {
  const path = getSecretFilePath(service);
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = SecretFileSchema.parse(JSON.parse(raw));
    return parsed.keys;
  } catch {
    return [];
  }
}

function writeSecretFile(service: string, keys: SavedSecret[]): void {
  ensureSecretsDir();
  const path = getSecretFilePath(service);
  writeFileSync(path, JSON.stringify({ keys }, null, 2));
}

export function getSecretsForService(service: string): SavedSecret[] {
  return readSecretFile(service);
}

export function saveSecret(service: string, name: string, value: string): SavedSecret {
  const keys = readSecretFile(service);
  const id = generateSecretId(service, name);
  const secret: SavedSecret = {
    id,
    name,
    value,
    createdAt: new Date().toISOString(),
  };
  keys.push(secret);
  writeSecretFile(service, keys);
  return secret;
}

export function deleteSecret(service: string, id: string): boolean {
  const keys = readSecretFile(service);
  const idx = keys.findIndex((k) => k.id === id);
  if (idx < 0) return false;
  keys.splice(idx, 1);
  writeSecretFile(service, keys);
  return true;
}

function secretIdExists(service: string, id: string): boolean {
  return readSecretFile(service).some((k) => k.id === id);
}

export function generateSecretId(service: string, name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  let id = base;
  let counter = 1;
  while (secretIdExists(service, id)) {
    id = `${base}-${counter}`;
    counter++;
  }
  return id;
}
