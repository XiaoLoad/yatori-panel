/**
 * 归一化平台地址：用户常把登录页完整地址粘贴进来（如 https://host/user），
 * 而英华 SDK 以根路径拼接 /user/login.json 与 /api/*，带路径会全部 404。
 * 规则：
 * - 缺少协议时补 https://
 * - 英华只保留协议 + 主机（含端口），丢弃路径/参数/锚点
 * - 其他平台保留路径，仅去掉结尾斜杠与参数
 */
export function normalizeBaseUrl(raw: string, platform: string): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname) return value;
    if (platform === "YINGHUA") {
      return `${parsed.protocol}//${parsed.host}`;
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return value;
  }
}
