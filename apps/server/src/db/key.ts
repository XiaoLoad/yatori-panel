import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env.ts";

// 机器本地密钥：首次运行生成，落在 data/secret.key（随目录走，重装面板仍可解密）。
// 密钥在进程生命周期内不可变，启动时读一次并缓存，避免每个请求都同步读盘。
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

let cachedKey: Buffer | null = null;

/** 会话签名等认证用途的密钥：进程内缓存，首次调用时加载 */
export function machineKey(): Buffer {
  return (cachedKey ??= loadKey());
}
