// 共享类型统一出口：实现仍在 packages/shared（前端 M3 通过 Vite alias 引同一份源码）。
// 服务器端用相对 .ts 导入，绕开 Node 原生 TS 对 node_modules 内文件的限制。
export * from "../../../packages/shared/src/index.ts";
