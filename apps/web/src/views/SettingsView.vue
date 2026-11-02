<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Ban,
  BrainCircuit,
  Database,
  Gauge,
  Lock,
  Mail,
  PencilLine,
  RotateCcw,
  Save,
} from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { Settings } from "@yatori/shared";
import { api } from "@/api/resources";
import { useAuthStore } from "@/stores/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useReveal } from "@/composables/useReveal";

const queryClient = useQueryClient();
const auth = useAuthStore();

const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });

// ---------- 草稿（暂存区）与服务端快照分离 ----------
// 查询 refetch 不会覆盖草稿：只有首次加载、保存成功、显式放弃时才同步，
// 否则用户未保存的修改会被窗口聚焦触发的 refetch 悄悄弹回去（旧 bug 根因）。

const serverData = ref<Settings | null>(null);
const draft = reactive<Settings>({
  ai: { enabled: false, type: "TONGYI", url: "", model: "", apiKey: "" },
  questionBank: { enabled: false, url: "", key: "" },
  email: { enabled: false, smtpHost: "", smtpPort: 465, user: "", pass: "", to: "" },
  tickSeconds: 5,
  maxAccountsConcurrency: 3,
});
const loaded = ref(false);

function syncFromServer(data: Settings) {
  // JSON 深拷贝：查询结果可能含响应式代理，structuredClone 会抛异常
  const snap = JSON.parse(JSON.stringify(data)) as Settings;
  serverData.value = snap;
  draft.ai = { ...snap.ai };
  draft.questionBank = { ...snap.questionBank };
  draft.email = { ...snap.email };
  draft.tickSeconds = snap.tickSeconds;
  draft.maxAccountsConcurrency = snap.maxAccountsConcurrency;
}

watch(settingsQuery.data, (data) => {
  if (!data) return;
  if (!loaded.value) {
    syncFromServer(data);
    loaded.value = true;
    return;
  }
  // 有未保存修改时不覆盖草稿；服务端数据本来就与上次快照一致
  const fresh = JSON.stringify(data);
  const known = serverData.value ? JSON.stringify(serverData.value) : "";
  if (fresh !== known && !dirtyKeys.value.length) {
    syncFromServer(data);
  } else if (fresh !== known) {
    serverData.value = JSON.parse(JSON.stringify(data)) as Settings;
  }
});

// ---------- 脏数据对比 ----------

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
    "email.enabled": s.email.enabled,
    "email.smtpHost": s.email.smtpHost,
    "email.smtpPort": s.email.smtpPort,
    "email.user": s.email.user,
    "email.pass": s.email.pass,
    "email.to": s.email.to,
  };
}

function mask(key: string, v: string | number | boolean) {
  if (SECRET_KEYS.has(key) && typeof v === "string" && v) return "••••••";
  return String(v);
}

const serverFlat = computed(() => flatten(serverData.value ?? draft));
const draftFlat = computed(() => flatten(draft));

const dirtyKeys = computed(() =>
  Object.keys(LABELS).filter((k) => serverFlat.value[k] !== draftFlat.value[k]),
);

const changes = computed(() =>
  dirtyKeys.value.map((k) => ({
    key: k,
    label: LABELS[k],
    old: mask(k, serverFlat.value[k]),
    new: mask(k, draftFlat.value[k]),
  })),
);

const isDirty = computed(() => dirtyKeys.value.length > 0);

function isFieldDirty(path: string) {
  return dirtyKeys.value.includes(path);
}

// ---------- 保存 / 放弃 ----------

const saveMutation = useMutation({
  mutationFn: () => api.saveSettings(JSON.parse(JSON.stringify(draft)) as Settings),
  onSuccess: async () => {
    toast.success(`设置已保存（${dirtyKeys.value.length} 项修改）`);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
    // invalidate 后 refetch 数据与草稿一致，watch 会自然对齐
  },
  onError: (err) => toast.error((err as Error).message),
});

function discardAll() {
  if (serverData.value) syncFromServer(serverData.value);
  toast.success("已放弃未保存的修改");
}

// ---------- 预检（测试连接） ----------

const aiTestMutation = useMutation({
  mutationFn: () =>
    api.preflight({
      source: "ai",
      ai: {
        type: draft.ai.type,
        url: draft.ai.url,
        model: draft.ai.model,
        apiKey: draft.ai.apiKey,
      },
    }),
  onSuccess: (r) => {
    if (r.available) toast.success("AI 连接正常");
    else toast.error(`AI 不可用：${r.error ?? "未知原因"}`);
  },
  onError: (err) => toast.error((err as Error).message),
});

const bankTestMutation = useMutation({
  mutationFn: () =>
    api.preflight({
      source: "bank",
      questionBank: { url: draft.questionBank.url, key: draft.questionBank.key },
    }),
  onSuccess: (r) => {
    if (r.available) toast.success("题库连接正常");
    else toast.error(`题库不可用：${r.error ?? "未知原因"}`);
  },
  onError: (err) => toast.error((err as Error).message),
});

// ---------- 表单交互 ----------

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

const emailPortModel = computed({
  get: () => String(draft.email.smtpPort),
  set: (v: string) => {
    const n = Number(v);
    draft.email.smtpPort = Math.min(65535, Math.max(1, Number.isFinite(n) ? n : 465));
  },
});

const showDiff = ref(false);

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

const root = ref<HTMLElement | null>(null);
useReveal(() => root.value);

// ---------- 访问锁（独立于设置草稿的即时操作） ----------

const newPassword = ref("");
const passwordPending = ref(false);

const passwordMutation = useMutation({
  mutationFn: () => api.setPassword(newPassword.value),
  onSuccess: async () => {
    toast.success("访问密码已生效");
    newPassword.value = "";
    await auth.refresh();
  },
  onError: (err) => toast.error((err as Error).message),
});

const disableMutation = useMutation({
  mutationFn: () => api.disablePassword(),
  onSuccess: async () => {
    toast.success("访问锁已关闭，全部会话已失效");
    await auth.refresh();
  },
  onError: (err) => toast.error((err as Error).message),
});
</script>

<template>
  <div ref="root" class="mx-auto max-w-3xl space-y-6">
    <div class="reveal flex items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">全局设置</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          修改会先暂存在页面上，确认无误后一键保存
        </p>
      </div>
    </div>

    <!-- 暂存/脏数据栏 -->
    <div
      v-if="isDirty"
      class="reveal sticky top-14 z-30 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
    >
      <Badge variant="warning" class="tabular-nums">已修改 {{ dirtyKeys.length }} 项</Badge>
      <button
        class="text-sm text-muted-foreground underline-offset-2 hover:underline"
        @click="showDiff = !showDiff"
      >
        {{ showDiff ? "收起变更明细" : "查看变更明细" }}
      </button>
      <div class="ms-auto flex items-center gap-2">
        <Button variant="outline" size="sm" @click="discardAll">
          <RotateCcw />放弃修改
        </Button>
        <Button
          size="sm"
          :disabled="saveMutation.isPending.value"
          @click="saveMutation.mutate()"
        >
          <Save />{{ saveMutation.isPending.value ? "保存中…" : "保存设置" }}
        </Button>
      </div>
    </div>

    <!-- 变更明细（原值 → 新值） -->
    <Card v-if="isDirty && showDiff" class="reveal border-amber-500/40">
      <CardHeader class="pb-2">
        <CardTitle class="flex items-center gap-2 text-base">
          <PencilLine class="size-4" />变更明细
        </CardTitle>
        <CardDescription>保存后以下修改将生效</CardDescription>
      </CardHeader>
      <CardContent class="space-y-1.5 text-sm">
        <div v-for="c in changes" :key="c.key" class="flex flex-wrap items-center gap-2">
          <span class="w-44 shrink-0 text-muted-foreground">{{ c.label }}</span>
          <span class="rounded bg-muted px-1.5 py-0.5 line-through" :class="{ 'opacity-50': c.old === '' }">
            {{ c.old === "" ? "（空）" : c.old }}
          </span>
          <span class="text-muted-foreground">→</span>
          <span class="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
            {{ c.new === "" ? "（空）" : c.new }}
          </span>
        </div>
      </CardContent>
    </Card>

    <!-- AI 答题 -->
    <Card class="reveal">
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-muted">
            <BrainCircuit class="size-4 text-muted-foreground" />
          </div>
          <div class="space-y-0.5">
            <CardTitle class="text-base">AI 答题</CardTitle>
            <CardDescription>任务选择「AI 答题」时使用；密钥仅存本机</CardDescription>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <Badge v-if="isFieldDirty('ai.enabled') || dirtyKeys.some((k) => k.startsWith('ai.'))" variant="warning">
            已修改
          </Badge>
          <Switch v-model="draft.ai.enabled" />
        </div>
      </CardHeader>
      <CardContent class="space-y-4" :class="draft.ai.enabled ? '' : 'opacity-60'">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>模型类型</Label>
              <span v-if="isFieldDirty('ai.type')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Select v-model="aiTypeModel" :options="AI_TYPES" :disabled="!draft.ai.enabled" />
          </div>
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>模型名称</Label>
              <span v-if="isFieldDirty('ai.model')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input v-model="draft.ai.model" placeholder="如 qwen-plus" :disabled="!draft.ai.enabled" />
          </div>
          <div class="grid gap-2 md:col-span-2">
            <div class="flex items-center justify-between">
              <Label>接口地址</Label>
              <span v-if="isFieldDirty('ai.url')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input v-model="draft.ai.url" placeholder="https://..." :disabled="!draft.ai.enabled" />
          </div>
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>API Key</Label>
              <span v-if="isFieldDirty('ai.apiKey')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input
              v-model="draft.ai.apiKey"
              type="password"
              placeholder="sk-..."
              autocomplete="off"
              :disabled="!draft.ai.enabled"
            />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          :disabled="aiTestMutation.isPending.value || !draft.ai.apiKey"
          @click="aiTestMutation.mutate()"
        >
          {{ aiTestMutation.isPending.value ? "测试中…" : "测试连接" }}
        </Button>
      </CardContent>
    </Card>

    <!-- 外置题库 -->
    <Card class="reveal">
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Database class="size-4 text-muted-foreground" />
          </div>
          <div class="space-y-0.5">
            <CardTitle class="text-base">外置题库</CardTitle>
            <CardDescription>对接 yatori-go-quesbank 等题库服务</CardDescription>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <Badge
            v-if="isFieldDirty('questionBank.enabled') || dirtyKeys.some((k) => k.startsWith('questionBank.'))"
            variant="warning"
          >
            已修改
          </Badge>
          <Switch v-model="draft.questionBank.enabled" />
        </div>
      </CardHeader>
      <CardContent class="space-y-4" :class="draft.questionBank.enabled ? '' : 'opacity-60'">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2 md:col-span-2">
            <div class="flex items-center justify-between">
              <Label>服务地址</Label>
              <span v-if="isFieldDirty('questionBank.url')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input
              v-model="draft.questionBank.url"
              placeholder="如 http://host:8083/api/external/yatori?token=xxx（密钥随 URL 参数携带）"
              :disabled="!draft.questionBank.enabled"
            />
          </div>
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>访问密钥</Label>
              <span v-if="isFieldDirty('questionBank.key')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input
              v-model="draft.questionBank.key"
              type="password"
              autocomplete="off"
              placeholder="多数题库服务把密钥拼在地址里，本项留空即可"
              :disabled="!draft.questionBank.enabled"
            />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          :disabled="bankTestMutation.isPending.value || !draft.questionBank.url"
          @click="bankTestMutation.mutate()"
        >
          {{ bankTestMutation.isPending.value ? "测试中…" : "测试连接" }}
        </Button>
      </CardContent>
    </Card>

    <!-- 邮箱通知 -->
    <Card class="reveal">
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Mail class="size-4 text-muted-foreground" />
          </div>
          <div class="space-y-0.5">
            <CardTitle class="text-base">邮箱通知</CardTitle>
            <CardDescription>任务完成/出错时发送邮件（手动停止不打扰）</CardDescription>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <Badge
            v-if="dirtyKeys.some((k) => k.startsWith('email.'))"
            variant="warning"
          >
            已修改
          </Badge>
          <Switch v-model="draft.email.enabled" />
        </div>
      </CardHeader>
      <CardContent class="space-y-4" :class="draft.email.enabled ? '' : 'opacity-60'">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>SMTP 服务器</Label>
              <span v-if="isFieldDirty('email.smtpHost')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input v-model="draft.email.smtpHost" placeholder="smtp.qq.com" :disabled="!draft.email.enabled" />
          </div>
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>端口</Label>
              <span v-if="isFieldDirty('email.smtpPort')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input v-model="emailPortModel" type="number" min="1" max="65535" :disabled="!draft.email.enabled" />
          </div>
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>发件邮箱账号</Label>
              <span v-if="isFieldDirty('email.user')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input v-model="draft.email.user" placeholder="xxx@qq.com" :disabled="!draft.email.enabled" />
          </div>
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>密码 / 授权码</Label>
              <span v-if="isFieldDirty('email.pass')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input
              v-model="draft.email.pass"
              type="password"
              autocomplete="off"
              :disabled="!draft.email.enabled"
            />
          </div>
          <div class="grid gap-2 md:col-span-2">
            <div class="flex items-center justify-between">
              <Label>收件人</Label>
              <span v-if="isFieldDirty('email.to')" class="text-[11px] text-amber-600">已修改</span>
            </div>
            <Input
              v-model="draft.email.to"
              placeholder="多个收件人用英文逗号分隔"
              :disabled="!draft.email.enabled"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 调度参数 -->
    <Card class="reveal">
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Gauge class="size-4 text-muted-foreground" />
          </div>
          <div class="space-y-0.5">
            <CardTitle class="text-base">调度参数</CardTitle>
            <CardDescription>提交节奏贴近真实播放可降低风控风险</CardDescription>
          </div>
        </div>
        <Badge v-if="isFieldDirty('tickSeconds') || isFieldDirty('maxAccountsConcurrency')" variant="warning">
          已修改
        </Badge>
      </CardHeader>
      <CardContent class="grid gap-4 md:grid-cols-2">
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label>学时提交间隔（秒）</Label>
            <span v-if="isFieldDirty('tickSeconds')" class="text-[11px] text-amber-600">已修改</span>
          </div>
          <Input v-model="tickModel" type="number" min="3" max="30" />
        </div>
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label>最大同时运行账号数</Label>
            <span v-if="isFieldDirty('maxAccountsConcurrency')" class="text-[11px] text-amber-600">已修改</span>
          </div>
          <Input v-model="concurrencyModel" type="number" min="1" max="10" />
        </div>
      </CardContent>
    </Card>

    <!-- 访问锁（独立即时生效，不参与草稿） -->
    <Card class="reveal">
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Lock class="size-4 text-muted-foreground" />
          </div>
          <div class="space-y-0.5">
            <CardTitle class="text-base">访问锁</CardTitle>
            <CardDescription>
              {{
                auth.authRequired
                  ? "已启用：面板与接口需凭密码登录（服务器部署必开）"
                  : "未启用：当前仅本机可访问。部署到服务器前请务必设置密码"
              }}
            </CardDescription>
          </div>
        </div>
        <Badge :variant="auth.authRequired ? 'success' : 'outline'">
          {{ auth.authRequired ? "已启用" : "未启用" }}
        </Badge>
      </CardHeader>
      <CardContent>
        <form class="flex items-end gap-3" @submit.prevent="passwordMutation.mutate()">
          <div class="grid flex-1 gap-2">
            <Label for="newPassword">
              {{ auth.authRequired ? "修改访问密码" : "设置访问密码" }}
            </Label>
            <Input
              id="newPassword"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              placeholder="至少 6 位"
              required
              minlength="6"
            />
          </div>
          <Button type="submit" :disabled="passwordPending || !newPassword">
            {{ passwordPending ? "保存中…" : auth.authRequired ? "修改" : "启用" }}
          </Button>
          <Button
            v-if="auth.authRequired"
            type="button"
            variant="outline"
            :disabled="disableMutation.isPending.value"
            @click="disableMutation.mutate()"
          >
            <Ban />关闭访问锁
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
