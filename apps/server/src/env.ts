import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src → 仓库根
export const repoRoot = path.resolve(here, "..", "..", "..");

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  host: process.env.PANEL_HOST ?? "127.0.0.1",
  port: int(process.env.PANEL_PORT, 8080),
  gatewayURL: process.env.GATEWAY_URL ?? "http://127.0.0.1:9801",
  dataDir: process.env.PANEL_DATA_DIR ?? path.join(repoRoot, "data"),
};
