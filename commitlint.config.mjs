export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 本项目约定的 scope 枚举；仓库级提交允许省略 scope
    "scope-enum": [2, "always", ["gateway", "server", "web", "shared", "deploy", "docs", "ci", "auth", "db", "quiz", "perf"]],
    "subject-empty": [2, "never"],
    "type-empty": [2, "never"],
    // 中文 subject 下句号规则无意义，关闭
    "subject-full-stop": [0],
  },
};
