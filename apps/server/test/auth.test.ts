import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 独立临时数据目录：auth 模块初始化依赖 db（settings 表），隔离测试环境
process.env.PANEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yatori-authtest-"));

const {
  authRequired,
  clearPassword,
  generateRandomPassword,
  passwordPolicyError,
  setPassword,
  verifyPassword,
} = await import("../src/db/auth.ts");

describe("password policy", () => {
  test("至少 8 位", () => {
    expect(passwordPolicyError("a1b2c3")).toMatch(/至少 8 位/);
  });

  test("单类字符被拒", () => {
    expect(passwordPolicyError("abcdefgh")).toMatch(/至少两类/);
    expect(passwordPolicyError("12345678")).toMatch(/至少两类/);
  });

  test("两类字符组合通过", () => {
    expect(passwordPolicyError("abcd1234")).toBeNull();
    expect(passwordPolicyError("abcd!!!!")).toBeNull();
    expect(passwordPolicyError("12345678x")).toBeNull();
  });
});

describe("random password", () => {
  test("长度与字符集", () => {
    const pwd = generateRandomPassword();
    expect(pwd.length).toBe(24);
    expect(pwd).toMatch(/^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });

  test("随机性：多次生成不重复", () => {
    const set = new Set(Array.from({ length: 20 }, () => generateRandomPassword()));
    expect(set.size).toBe(20);
  });
});

describe("auth required lifecycle", () => {
  test("初始无密码", () => {
    expect(authRequired()).toBe(false);
  });

  test("设置密码后生效，校验正确/错误密码", () => {
    setPassword("abcd1234");
    expect(authRequired()).toBe(true);
    expect(verifyPassword("abcd1234")).toBe(true);
    expect(verifyPassword("wrong-pass")).toBe(false);
  });

  test("清除密码后恢复放行", () => {
    clearPassword();
    expect(authRequired()).toBe(false);
    expect(verifyPassword("abcd1234")).toBe(false);
  });
});
