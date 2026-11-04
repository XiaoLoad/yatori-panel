import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env.ts";

// 加密密钥来源（二选一，优先环境变量）：
// 1. PANEL_SECRET_KEY：base64 的 32 字节密钥，由部署方注入——密钥可独立于数据目录保管，
//    备份数据卷不再等于泄露全部账号密码；生产部署推荐此方式。
// 2. 兜底生成 data/secret.key（机器本地密钥，重装面板仍可解密）。
const keyFile = path.join(env.dataDir, "secret.key");

function loadKey(): Buffer {
  if (env.secretKey) {
    const key = Buffer.from(env.secretKey, "base64");
    if (key.length === 32) return key;
    throw new Error("PANEL_SECRET_KEY 必须是 32 字节的 base64 密钥（可用 openssl rand -base64 32 生成）");
  }
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
