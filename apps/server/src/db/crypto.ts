import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env.ts";

// 机器本地密钥：首次运行生成，落在 data/secret.key（随目录走，重装面板仍可解密）
const keyFile = path.join(env.dataDir, "secret.key");

function loadKey(): Buffer {
  fs.mkdirSync(env.dataDir, { recursive: true });
  if (fs.existsSync(keyFile)) {
    const raw = fs.readFileSync(keyFile, "utf8").trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString("base64"), { mode: 0o600 });
  return key;
}

const KEY = loadKey();

/** AES-256-GCM 加密，输出 base64(iv).base64(tag).base64(cipher) */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("密文格式非法");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    KEY,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
