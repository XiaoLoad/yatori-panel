import { env } from "./env.ts";
import type { GatewayLogEntry } from "./gateway.ts";

export class HttpError extends Error {
  status: number;
  logs?: GatewayLogEntry[];
  constructor(status: number, message: string, logs?: GatewayLogEntry[]) {
    super(message);
    this.status = status;
    this.logs = logs;
  }
}
