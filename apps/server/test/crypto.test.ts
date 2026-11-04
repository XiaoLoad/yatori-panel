import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 独立临时数据目录：crypto 模块按 env.dataDir 初始化，隔离测试不碰真实 data/
process.env.PANEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yatori-cryptotest-"));

const { decryptSecret, encryptSecret } = await import("../src/db/crypto.ts");

describe("secret crypto (AES-256-GCM)", () => {
  test("加解密往返", () => {
    const plain = "p@ssw0rd-中文-🔐";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  test("密文随机化：同一明文两次加密产生不同密文", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  test("密文格式非法时抛错", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow();
  });

  test("密文被篡改时 GCM 校验失败", () => {
    const payload = encryptSecret("secret");
    const parts = payload.split(".");
    const data = Buffer.from(parts[2]!, "base64");
    data[0] = data[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], data.toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
