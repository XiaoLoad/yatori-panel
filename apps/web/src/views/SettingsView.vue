<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Ban, BrainCircuit, ChevronDown, ChevronUp, Database, Gauge, Lock, Mail, RotateCcw, Save, ScrollText, TriangleAlert } from "lucide-vue-next";
import { computed, markRaw, reactive, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { Settings } from "@yatori/shared";
import { api } from "@/api/resources";
import { useAuthStore } from "@/stores/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { confirmAction } from "@/lib/confirm";
import { cn } from "@/lib/utils";

const queryClient = useQueryClient();
const auth = useAuthStore();
const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });

const serverData = ref<Settings | null>(null);
const draft = reactive<Settings>({
  ai: { enabled: false, type: "TONGYI", url: "", model: "", apiKey: "" },
  questionBank: { enabled: false, url: "", key: "" },
  email: { enabled: false, smtpHost: "", smtpPort: 465, user: "", pass: "", to: "" },
  tickSeconds: 5,
  maxAccountsConcurrency: 3,
  maxCoursesConcurrency: 3,
  logLevel: "info",
});
const loaded = ref(false);

function syncFromServer(data: Settings) {
  const snap = JSON.parse(JSON.stringify(data)) as Settings;
  serverData.value = snap;
  draft.ai = { ...snap.ai };
  draft.questionBank = { ...snap.questionBank };
  draft.email = { ...snap.email };
  draft.tickSeconds = snap.tickSeconds;
  draft.maxAccountsConcurrency = snap.maxAccountsConcurrency;
  draft.maxCoursesConcurrency = snap.maxCoursesConcurrency;
  draft.logLevel = snap.logLevel;
}

// immediate 必开：再次进入设置页时 TanStack Query 命中缓存且结构共享会让
// data 引用不变，watcher 不触发，表单就会停留在默认空值（需刷新才回显）
watch(
  settingsQuery.data,
  (data) => {
    if (!data) return;
    if (!loaded.value) {
      syncFromServer(data);
      loaded.value = true;
      return;
    }
    const fresh = JSON.stringify(data);
    const known = serverData.value ? JSON.stringify(serverData.value) : "";
    if (fresh !== known && !dirtyKeys.value.length) {
      syncFromServer(data);
    } else if (fresh !== known) {
      serverData.value = JSON.parse(JSON.stringify(data)) as Settings;
    }
  },
  { immediate: true },
);

const LABELS: Record<string, string> = {
  "ai.enabled": "AI 答题开关",
  "ai.type": "AI 模型类型",
  "ai.url": "AI 接口地址",
  "ai.model": "AI 模型名称",
  "ai.apiKey": "API Key",
  "questionBank.enabled": "外置题库开关",
  "questionBank.url": "题库服务地址",
  "questionBank.key": "题库密钥",
  tickSeconds: "学时提交间隔（秒）",
  maxAccountsConcurrency: "最大并发账号数",
  maxCoursesConcurrency: "单账号课程并发数",
  logLevel: "日志输出档位",
  "email.enabled": "邮箱通知开关",
  "email.smtpHost": "SMTP 服务器",
  "email.smtpPort": "SMTP 端口",
  "email.user": "发件邮箱账号",
  "email.pass": "发件邮箱密码/授权码",
  "email.to": "收件人",
};
const SECRET_KEYS = new Set(["ai.apiKey", "questionBank.key", "email.pass"]);

function flatten(s: Settings): Record<string, string | number | boolean> {
  return {
    "ai.enabled": s.ai.enabled,
    "ai.type": s.ai.type,
    "ai.url": s.ai.url,
    "ai.model": s.ai.model,
    "ai.apiKey": s.ai.apiKey,
    "questionBank.enabled": s.questionBank.enabled,
    "questionBank.url": s.questionBank.url,
    "questionBank.key": s.questionBank.key,
    tickSeconds: s.tickSeconds,
    maxAccountsConcurrency: s.maxAccountsConcurrency,
    maxCoursesConcurrency: s.maxCoursesConcurrency,
    logLevel: s.logLevel,
    "email.enabled": s.email.enabled,
    "email.smtpHost": s.email.smtpHost,
    "email.smtpPort": s.email.smtpPort,
    "email.user": s.email.user,
    "email.pass": s.email.pass,
    "email.to": s.email.to,
  };
}

/** 明细面板按配置分组展示，避免一长串平铺 */
const GROUPS = [
  { key: "run", label: "运行参数", icon: markRaw(Gauge), match: (k: string) => !k.includes(".") && k !== "logLevel" },
  { key: "log", label: "日志输出", icon: markRaw(ScrollText), match: (k: string) => k === "logLevel" },
  { key: "ai", label: "AI 答题", icon: markRaw(BrainCircuit), match: (k: string) => k.startsWith("ai.") },
  { key: "bank", label: "外置题库", icon: markRaw(Database), match: (k: string) => k.startsWith("questionBank.") },
  { key: "email", label: "邮箱通知", icon: markRaw(Mail), match: (k: string) => k.startsWith("email.") },
] as const;

function displayValue(key: string, v: string | number | boolean): string {
  if (SECRET_KEYS.has(key)) return typeof v === "string" && v ? "已设置" : "（空）";
  if (typeof v === "boolean") return v ? "开启" : "关闭";
  if (v === "") return "（空）";
  return String(v);
}

const serverFlat = computed(() => flatten(serverData.value ?? draft));
const draftFlat = computed(() => flatten(draft));
const dirtyKeys = computed(() => Object.keys(LABELS).filter((k) => serverFlat.value[k] !== draftFlat.value[k]));
const isDirty = computed(() => dirtyKeys.value.length > 0);
const changes = computed(() =>
  dirtyKeys.value.map((k) => {
    const secret = SECRET_KEYS.has(k);
    return {
      key: k,
      label: LABELS[k],
      old: secret ? (serverFlat.value[k] ? "已设置" : "（空）") : displayValue(k, serverFlat.value[k]!),
      new: secret ? (draftFlat.value[k] ? "已填写（隐藏）" : "（空）") : displayValue(k, draftFlat.value[k]!),
    };
  }),
);
const groupedChanges = computed(() =>
  GROUPS.map((g) => ({ ...g, items: changes.value.filter((c) => g.match(c.key)) })).filter((g) => g.items.length),
);
const showDiff = ref(false);
watch(isDirty, (dirty) => {
  if (!dirty) showDiff.value = false;
});

const saveMutation = useMutation({
  mutationFn: () => api.saveSettings(JSON.parse(JSON.stringify(draft)) as Settings),
  onSuccess: () => {
    toast.success(`设置已保存（${dirtyKeys.value.length} 项修改）`);
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  },
  onError: (err) => toast.error((err as Error).message),
});

function discardAll() {
  if (serverData.value) syncFromServer(serverData.value);
  toast.success("已放弃未保存的修改");
}

const aiTestMutation = useMutation({
  mutationFn: () =>
    api.preflight({
      source: "ai",
      ai: { type: draft.ai.type, url: draft.ai.url, model: draft.ai.model, apiKey: draft.ai.apiKey },
    }),
  onSuccess: (r) => (r.available ? toast.success("AI 连接正常") : toast.error(`AI 不可用：${r.error ?? "未知原因"}`)),
  onError: (err) => toast.error((err as Error).message),
});

const bankTestMutation = useMutation({
  mutationFn: () =>
    api.preflight({ source: "bank", questionBank: { url: draft.questionBank.url, key: draft.questionBank.key } }),
  onSuccess: (r) => (r.available ? toast.success("题库连接正常") : toast.error(`题库不可用：${r.error ?? "未知原因"}`)),
  onError: (err) => toast.error((err as Error).message),
});

const emailTestMutation = useMutation({
  mutationFn: () => api.testEmail({ email: JSON.parse(JSON.stringify(draft.email)) as Settings["email"] }),
  onSuccess: (r) => toast.success(r.message),
  onError: (err) => toast.error((err as Error).message),
});

const aiTypeModel = computed({
  get: () => draft.ai.type,
  set: (v: string) => {
    draft.ai.type = v;
  },
});
const tickModel = computed({
  get: () => String(draft.tickSeconds),
  set: (v: string) => {
    const n = Number(v);
    draft.tickSeconds = Math.min(30, Math.max(3, Number.isFinite(n) ? n : 5));
  },
});
const concurrencyModel = computed({
  get: () => String(draft.maxAccountsConcurrency),
  set: (v: string) => {
    const n = Number(v);
    draft.maxAccountsConcurrency = Math.min(10, Math.max(1, Number.isFinite(n) ? n : 3));
  },
});
const courseConcurrencyModel = computed({
  get: () => String(draft.maxCoursesConcurrency),
  set: (v: string) => {
    const n = Number(v);
    draft.maxCoursesConcurrency = Math.min(5, Math.max(1, Number.isFinite(n) ? n : 3));
  },
});
const emailPortModel = computed({
  get: () => String(draft.email.smtpPort),
  set: (v: string) => {
    const n = Number(v);
    draft.email.smtpPort = Math.min(65535, Math.max(1, Number.isFinite(n) ? n : 465));
  },
});

const AI_TYPES = [
  { value: "TONGYI", label: "通义千问" },
  { value: "DEEPSEEK", label: "DeepSeek" },
  { value: "OPENAI", label: "OpenAI 兼容" },
  { value: "CHATGLM", label: "智谱 ChatGLM" },
  { value: "XINGHUO", label: "讯飞星火" },
  { value: "DOUBAO", label: "豆包" },
  { value: "METAAI", label: "MetaAI" },
  { value: "SILICON", label: "硅基流动" },
  { value: "OTHER", label: "其他" },
];

const newPassword = ref("");
const confirmPassword = ref("");
const oldPassword = ref("");
/** 两次输入的新密码不一致时的本地校验提示 */
const confirmMismatch = computed(() => confirmPassword.value !== "" && confirmPassword.value !== newPassword.value);
const passwordMutation = useMutation({
  mutationFn: () => api.setPassword(newPassword.value, auth.authRequired && !auth.initialPassword ? oldPassword.value : undefined),
  onSuccess: async () => {
    toast.success("访问密码已生效");
    newPassword.value = "";
    confirmPassword.value = "";
    oldPassword.value = "";
    await auth.refresh();
  },
  onError: (err) => toast.error((err as Error).message),
});

/** 提交前本地校验：两次输入一致才允许提交 */
function submitPassword() {
  if (newPassword.value !== confirmPassword.value) {
    toast.error("两次输入的新密码不一致");
    return;
  }
  passwordMutation.mutate();
}
const disableMutation = useMutation({
  mutationFn: () => api.disablePassword(),
  onSuccess: async () => {
    toast.success("访问锁已关闭，全部会话已失效");
    await auth.refresh();
  },
  onError: (err) => toast.error((err as Error).message),
});

async function askDisable() {
  const ok = await confirmAction({
    title: "关闭访问锁？",
    description: "关闭后本机所有已登录会话会立即失效，任何人都能直接打开面板，可随时重新启用。",
    confirmText: "关闭访问锁",
    tone: "danger",
  });
  if (ok) disableMutation.mutate();
}

/** 初始密码未更换：显示引导提示 */
const needsInitialChange = computed(() => auth.authRequired && auth.initialPassword);
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <h1 class="display-title text-[26px] leading-none">设置</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">修改先暂存，确认后一键保存；密钥仅存本机</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <span class="mono rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground">
          {{ isDirty ? `待保存 ${dirtyKeys.length} 项` : "已同步" }}
        </span>
      </div>
    </header>

    <div class="grid gap-3 lg:grid-cols-2">
      <!-- AI -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><BrainCircuit class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[15.5px] font-semibold">AI 答题</h2>
            <p class="text-[13px] text-muted-foreground">任务选择「AI 答题」时使用</p>
          </div>
          <Switch v-model="draft.ai.enabled" class="ml-auto" />
        </div>
        <div class="mt-3 grid gap-2.5" :class="draft.ai.enabled ? '' : 'opacity-50'">
          <div class="grid grid-cols-2 gap-2.5">
            <div class="grid gap-1">
              <Label class="text-[13px]">模型类型</Label>
              <Select v-model="aiTypeModel" :options="AI_TYPES" :disabled="!draft.ai.enabled" class="h-8 text-[13.5px]" />
            </div>
            <div class="grid gap-1">
              <Label class="text-[13px]">模型名称</Label>
              <Input v-model="draft.ai.model" placeholder="qwen-plus" :disabled="!draft.ai.enabled" class="h-8 text-[13.5px]" />
            </div>
          </div>
          <div class="grid gap-1">
            <Label class="text-[13px]">接口地址</Label>
            <Input v-model="draft.ai.url" placeholder="https://..." :disabled="!draft.ai.enabled" class="h-8 text-[13.5px]" />
          </div>
          <div class="grid gap-1">
            <Label class="text-[13px]">API Key</Label>
            <Input v-model="draft.ai.apiKey" type="password" placeholder="sk-..." autocomplete="off" :disabled="!draft.ai.enabled" class="h-8 text-[13.5px]" />
          </div>
          <Button variant="outline" size="sm" class="h-7 w-fit text-[13.5px]" :disabled="aiTestMutation.isPending.value || !draft.ai.apiKey" @click="aiTestMutation.mutate()">
            {{ aiTestMutation.isPending.value ? "测试中…" : "测试连接" }}
          </Button>
        </div>
      </section>

      <!-- 题库 -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Database class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[15.5px] font-semibold">外置题库</h2>
            <p class="text-[13px] text-muted-foreground">对接 yatori-go-quesbank 等题库服务</p>
          </div>
          <Switch v-model="draft.questionBank.enabled" class="ml-auto" />
        </div>
        <div class="mt-3 grid gap-2.5" :class="draft.questionBank.enabled ? '' : 'opacity-50'">
          <div class="grid gap-1">
            <Label class="text-[13px]">服务地址</Label>
            <Input v-model="draft.questionBank.url" placeholder="http://host:8083/api/external/yatori?token=xxx" :disabled="!draft.questionBank.enabled" class="h-8 text-[13.5px]" />
          </div>
          <div class="grid gap-1">
            <Label class="text-[13px]">访问密钥（多随 URL 携带，可留空）</Label>
            <Input v-model="draft.questionBank.key" type="password" autocomplete="off" placeholder="留空即可" :disabled="!draft.questionBank.enabled" class="h-8 text-[13.5px]" />
          </div>
          <Button variant="outline" size="sm" class="h-7 w-fit text-[13.5px]" :disabled="bankTestMutation.isPending.value || !draft.questionBank.url" @click="bankTestMutation.mutate()">
            {{ bankTestMutation.isPending.value ? "测试中…" : "测试连接" }}
          </Button>
        </div>
      </section>

      <!-- 邮箱 -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Mail class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[15.5px] font-semibold">邮箱通知</h2>
            <p class="text-[13px] text-muted-foreground">任务完成/出错时发送邮件</p>
          </div>
          <Switch v-model="draft.email.enabled" class="ml-auto" />
        </div>
        <div class="mt-3 grid gap-2.5" :class="draft.email.enabled ? '' : 'opacity-50'">
          <div class="grid grid-cols-[1fr_88px] gap-2.5">
            <div class="grid gap-1">
              <Label class="text-[13px]">SMTP 服务器</Label>
              <Input v-model="draft.email.smtpHost" placeholder="smtp.qq.com" :disabled="!draft.email.enabled" class="h-8 text-[13.5px]" />
            </div>
            <div class="grid gap-1">
              <Label class="text-[13px]">端口</Label>
              <Input v-model="emailPortModel" type="number" :disabled="!draft.email.enabled" class="h-8 text-[13.5px]" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <div class="grid gap-1">
              <Label class="text-[13px]">发件账号</Label>
              <Input v-model="draft.email.user" placeholder="xxx@qq.com" :disabled="!draft.email.enabled" class="h-8 text-[13.5px]" />
            </div>
            <div class="grid gap-1">
              <Label class="text-[13px]">密码 / 授权码</Label>
              <Input v-model="draft.email.pass" type="password" autocomplete="off" :disabled="!draft.email.enabled" class="h-8 text-[13.5px]" />
            </div>
          </div>
          <div class="grid gap-1">
            <Label class="text-[13px]">收件人（逗号分隔）</Label>
            <Input v-model="draft.email.to" placeholder="a@x.com, b@y.com" :disabled="!draft.email.enabled" class="h-8 text-[13.5px]" />
          </div>
          <div class="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-fit text-[13.5px]"
              :disabled="emailTestMutation.isPending.value || !draft.email.enabled || !draft.email.smtpHost || !draft.email.user || !draft.email.pass || !draft.email.to"
              @click="emailTestMutation.mutate()"
            >
              {{ emailTestMutation.isPending.value ? "发送中…" : "发送测试邮件" }}
            </Button>
            <p class="text-[12px] leading-snug text-muted-foreground">使用当前表单配置发送样例报告，无需先保存</p>
          </div>
        </div>
      </section>

      <!-- 调度 -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Gauge class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[15.5px] font-semibold">调度参数</h2>
            <p class="text-[13px] text-muted-foreground">提交节奏贴近真实播放可降低风控风险</p>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2.5">
          <div class="grid gap-1">
            <Label class="text-[13px]">学时提交间隔（秒）</Label>
            <Input v-model="tickModel" type="number" min="3" max="30" class="h-8 text-[13.5px]" />
            <p class="text-[12px] leading-snug text-muted-foreground">
              每隔几秒向平台提交一次进度。5 秒最接近真实播放，越小越快但更容易触发风控。
            </p>
          </div>
          <div class="grid gap-1">
            <Label class="text-[13px]">最大并发账号数（1—10）</Label>
            <Input v-model="concurrencyModel" type="number" min="1" max="10" class="h-8 text-[13.5px]" />
            <p class="text-[12px] leading-snug text-muted-foreground">
              同时跑几个账号的任务。超出的账号会排队等待，直到前面的任务结束。
            </p>
          </div>
          <div class="grid gap-1">
            <Label class="text-[13px]">单账号课程并发数（1—5）</Label>
            <Input v-model="courseConcurrencyModel" type="number" min="1" max="5" class="h-8 text-[13.5px]" />
            <p class="text-[12px] leading-snug text-muted-foreground">
              同一个账号同时刷几门课。1 = 逐门课串行；3 = 最多 3 门课同时推进。课程内视频的刷法由任务里的「刷课模式」决定。
            </p>
          </div>
        </div>
        <p class="mt-2 text-[12.5px] text-muted-foreground">
          两个并发是叠加的：账号之间并行由上一项控制，账号内的课程并行由这一项控制，互不影响。
        </p>
      </section>

      <!-- 日志输出 -->
      <section class="panel p-4 lg:col-span-2">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><ScrollText class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[15.5px] font-semibold">日志输出</h2>
            <p class="text-[13px] text-muted-foreground">日志页与观测台只显示不低于该档位的日志</p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div class="grid w-64 gap-1.5">
            <Label class="text-[13px]">输出档位</Label>
            <Select
              v-model="draft.logLevel"
              :options="[
                { value: 'debug', label: '调试（输出全部日志）' },
                { value: 'info', label: '信息及以上' },
                { value: 'warn', label: '警告及以上' },
                { value: 'error', label: '仅错误' },
              ]"
              class="h-8 text-[13.5px]"
            />
          </div>
          <p class="max-w-xl pb-1 text-[12px] leading-relaxed text-muted-foreground">
            调整后立即生效；已打开的页面会在下一次刷新时应用。日志仍会完整落库，不受显示档位影响。
          </p>
        </div>
      </section>

      <!-- 访问锁 -->
      <section class="panel p-4 lg:col-span-2">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Lock class="size-4" /></div>
          <div class="min-w-0 flex-1">
            <h2 class="text-[15.5px] font-semibold">访问锁</h2>
            <p class="text-[13px] text-muted-foreground">
              {{ auth.authRequired ? "已启用：面板与接口需凭密码登录" : "未启用：任何能访问面板的人都可以操作，部署到服务器前务必设置密码" }}
            </p>
          </div>
          <Badge :variant="auth.authRequired ? 'success' : 'outline'">{{ auth.authRequired ? "已启用" : "未启用" }}</Badge>
        </div>

        <!-- 初始密码引导：系统生成密码未更换时提示 -->
        <div v-if="needsInitialChange" class="mt-3 flex items-start gap-2 rounded-lg border border-amber/40 bg-amber/10 p-3">
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber" />
          <p class="text-[12.5px] leading-5 text-foreground/90">
            当前使用的是系统生成的初始密码（可在部署日志中查看）。请立即在下方设置你自己的访问密码——首次更换无需输入旧密码。
          </p>
        </div>

        <form class="mt-3.5 rounded-lg border border-border bg-panel-2/50 p-3.5" @submit.prevent="submitPassword">
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-if="auth.authRequired && !auth.initialPassword" class="grid gap-1.5 sm:col-span-2">
              <Label class="text-[13px]">旧密码</Label>
              <Input
                v-model="oldPassword"
                type="password"
                autocomplete="current-password"
                placeholder="当前访问密码"
                required
                class="h-8 text-[13.5px] sm:max-w-sm"
              />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-[13px]">{{ auth.authRequired ? "新访问密码" : "设置访问密码" }}</Label>
              <Input
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                placeholder="至少 8 位"
                required
                minlength="8"
                class="h-8 text-[13.5px]"
              />
              <p class="min-h-[18px] text-[12px] leading-snug text-muted-foreground">
                至少 8 位，需包含字母、数字、符号中的两类
              </p>
            </div>
            <div class="grid gap-1.5">
              <Label class="text-[13px]">确认新密码</Label>
              <Input
                v-model="confirmPassword"
                type="password"
                autocomplete="new-password"
                placeholder="再次输入新密码"
                required
                minlength="8"
                :class="cn('h-8 text-[13.5px]', confirmMismatch && 'border-red-500 focus-visible:ring-red-500')"
              />
              <p
                class="min-h-[18px] text-[12px] leading-snug"
                :class="confirmMismatch ? 'text-red-500' : 'text-muted-foreground'"
              >{{ confirmMismatch ? "两次输入不一致" : "再次输入以确认" }}</p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <template v-if="auth.authRequired && auth.lockEnforced">
              <!-- 生产部署：锁由部署配置强制，运行时不允许关闭 -->
              <span
                class="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground/60"
                title="生产部署（PANEL_AUTH_REQUIRED=true）不允许关闭访问锁；如需免密访问请修改部署配置后重启面板"
              >
                <Ban class="size-3.5" />关闭访问锁（已被部署配置锁定）
              </span>
            </template>
            <Button
              v-else-if="auth.authRequired"
              type="button"
              variant="ghost"
              size="sm"
              class="h-8 gap-1 text-[13px] text-muted-foreground hover:text-coral"
              :disabled="disableMutation.isPending.value"
              @click="askDisable"
            ><Ban class="size-3.5" />关闭访问锁</Button>
            <Button
              type="submit"
              size="sm"
              class="ml-auto h-8 text-[13px]"
              :disabled="passwordMutation.isPending.value || !newPassword || confirmMismatch"
            >{{ auth.authRequired ? "修改访问密码" : "启用访问锁" }}</Button>
          </div>
        </form>
      </section>
    </div>

    <!-- 未保存更改：固定在右下角，明细向上展开，不随页面滚动消失 -->
    <Teleport to="body">
      <div v-if="isDirty" class="fixed bottom-5 right-5 z-40 w-[min(440px,calc(100vw-2.5rem))]">
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 translate-y-2"
        >
          <div v-if="showDiff" class="panel mb-2 overflow-hidden shadow-xl">
            <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span class="text-[14px] font-medium">未保存的更改</span>
              <span class="mono rounded-full bg-amber/10 px-1.5 text-[12px] text-amber">{{ dirtyKeys.length }}</span>
              <button class="ml-auto text-[12.5px] text-muted-foreground hover:text-foreground" @click="showDiff = false">收起</button>
            </div>
            <div class="max-h-[46vh] overflow-y-auto px-4 py-1">
              <div v-for="g in groupedChanges" :key="g.key" class="border-b border-border/60 py-2 last:border-b-0">
                <div class="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium">
                  <component :is="g.icon" class="size-3.5 text-muted-foreground" />
                  {{ g.label }}
                  <span class="mono ml-auto text-muted-foreground">{{ g.items.length }}</span>
                </div>
                <div v-for="c in g.items" :key="c.key" class="flex items-start gap-2 py-1">
                  <span class="w-32 shrink-0 truncate text-[12.5px] text-muted-foreground" :title="c.label">{{ c.label }}</span>
                  <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span class="max-w-full truncate rounded bg-muted px-1.5 text-[12px] line-through opacity-70" :title="c.old">{{ c.old }}</span>
                    <span class="text-[12px] text-muted-foreground">→</span>
                    <span class="max-w-full truncate rounded bg-primary/10 px-1.5 text-[12px] text-primary" :title="c.new">{{ c.new }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <div class="panel flex flex-wrap items-center gap-2.5 border-amber/40 px-3 py-2.5 shadow-xl">
          <span class="size-2 shrink-0 animate-breathe rounded-full bg-amber" />
          <div class="min-w-0 flex-1">
            <div class="text-[13.5px] font-medium">未保存更改</div>
            <div class="text-[12px] text-muted-foreground">{{ dirtyKeys.length }} 项设置待保存</div>
          </div>
          <button
            class="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
            @click="showDiff = !showDiff"
          >
            {{ showDiff ? "收起明细" : "查看明细" }}
            <ChevronDown v-if="!showDiff" class="size-3.5" />
            <ChevronUp v-else class="size-3.5" />
          </button>
          <Button variant="outline" size="sm" class="h-7 gap-1 text-[13px]" @click="discardAll">
            <RotateCcw class="size-3.5" />放弃
          </Button>
          <Button size="sm" class="h-7 gap-1 text-[13px]" :disabled="saveMutation.isPending.value" @click="saveMutation.mutate()">
            <Save class="size-3.5" />{{ saveMutation.isPending.value ? "保存中…" : "保存" }}
          </Button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
