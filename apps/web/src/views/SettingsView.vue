<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Ban, BrainCircuit, Database, Gauge, Lock, Mail, RotateCcw, Save } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
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
}

watch(settingsQuery.data, (data) => {
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
});

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
const dirtyKeys = computed(() => Object.keys(LABELS).filter((k) => serverFlat.value[k] !== draftFlat.value[k]));
const isDirty = computed(() => dirtyKeys.value.length > 0);
const changes = computed(() =>
  dirtyKeys.value.map((k) => ({
    key: k,
    label: LABELS[k],
    old: mask(k, serverFlat.value[k]!),
    new: mask(k, draftFlat.value[k]!),
  })),
);
const showDiff = ref(false);

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
  <div class="space-y-4">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <div class="eyebrow">Calibration / Global</div>
        <h1 class="display-title mt-1.5 text-[26px] leading-none">设置</h1>
        <p class="mt-2 text-[11.5px] text-muted-foreground">修改先暂存，确认后一键保存；密钥仅存本机</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <span class="mono rounded-full border border-border px-2.5 py-1 text-[9px] text-muted-foreground">
          {{ isDirty ? `${dirtyKeys.length} PENDING` : "IN SYNC" }}
        </span>
      </div>
    </header>

    <div
      v-if="isDirty"
      class="sticky top-[60px] z-30 flex flex-wrap items-center gap-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-2.5"
    >
      <Badge variant="warning">已修改 {{ dirtyKeys.length }} 项</Badge>
      <button class="text-[11px] text-muted-foreground underline-offset-2 hover:underline" @click="showDiff = !showDiff">
        {{ showDiff ? "收起变更明细" : "查看变更明细" }}
      </button>
      <div class="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" class="h-7 text-[11px]" @click="discardAll"><RotateCcw class="size-3.5" />放弃</Button>
        <Button size="sm" class="h-7 text-[11px]" :disabled="saveMutation.isPending.value" @click="saveMutation.mutate()">
          <Save class="size-3.5" />{{ saveMutation.isPending.value ? "保存中…" : "保存设置" }}
        </Button>
      </div>
    </div>

    <div v-if="isDirty && showDiff" class="panel px-4 py-3">
      <div v-for="c in changes" :key="c.key" class="flex flex-wrap items-center gap-2 py-0.5 text-[11px]">
        <span class="w-40 shrink-0 text-muted-foreground">{{ c.label }}</span>
        <span class="rounded bg-muted px-1.5 line-through opacity-70">{{ c.old === "" ? "（空）" : c.old }}</span>
        <span class="text-muted-foreground">→</span>
        <span class="rounded bg-emerald-500/15 px-1.5 text-emerald-600 dark:text-emerald-400">{{ c.new === "" ? "（空）" : c.new }}</span>
      </div>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <!-- AI -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><BrainCircuit class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[13px] font-semibold">AI 答题</h2>
            <p class="text-[10.5px] text-muted-foreground">任务选择「AI 答题」时使用</p>
          </div>
          <Switch v-model="draft.ai.enabled" class="ml-auto" />
        </div>
        <div class="mt-3 grid gap-2.5" :class="draft.ai.enabled ? '' : 'opacity-50'">
          <div class="grid grid-cols-2 gap-2.5">
            <div class="grid gap-1">
              <Label class="text-[10.5px]">模型类型</Label>
              <Select v-model="aiTypeModel" :options="AI_TYPES" :disabled="!draft.ai.enabled" class="h-8 text-[11px]" />
            </div>
            <div class="grid gap-1">
              <Label class="text-[10.5px]">模型名称</Label>
              <Input v-model="draft.ai.model" placeholder="qwen-plus" :disabled="!draft.ai.enabled" class="h-8 text-[11px]" />
            </div>
          </div>
          <div class="grid gap-1">
            <Label class="text-[10.5px]">接口地址</Label>
            <Input v-model="draft.ai.url" placeholder="https://..." :disabled="!draft.ai.enabled" class="h-8 text-[11px]" />
          </div>
          <div class="grid gap-1">
            <Label class="text-[10.5px]">API Key</Label>
            <Input v-model="draft.ai.apiKey" type="password" placeholder="sk-..." autocomplete="off" :disabled="!draft.ai.enabled" class="h-8 text-[11px]" />
          </div>
          <Button variant="outline" size="sm" class="h-7 w-fit text-[11px]" :disabled="aiTestMutation.isPending.value || !draft.ai.apiKey" @click="aiTestMutation.mutate()">
            {{ aiTestMutation.isPending.value ? "测试中…" : "测试连接" }}
          </Button>
        </div>
      </section>

      <!-- 题库 -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Database class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[13px] font-semibold">外置题库</h2>
            <p class="text-[10.5px] text-muted-foreground">对接 yatori-go-quesbank 等题库服务</p>
          </div>
          <Switch v-model="draft.questionBank.enabled" class="ml-auto" />
        </div>
        <div class="mt-3 grid gap-2.5" :class="draft.questionBank.enabled ? '' : 'opacity-50'">
          <div class="grid gap-1">
            <Label class="text-[10.5px]">服务地址</Label>
            <Input v-model="draft.questionBank.url" placeholder="http://host:8083/api/external/yatori?token=xxx" :disabled="!draft.questionBank.enabled" class="h-8 text-[11px]" />
          </div>
          <div class="grid gap-1">
            <Label class="text-[10.5px]">访问密钥（多随 URL 携带，可留空）</Label>
            <Input v-model="draft.questionBank.key" type="password" autocomplete="off" placeholder="留空即可" :disabled="!draft.questionBank.enabled" class="h-8 text-[11px]" />
          </div>
          <Button variant="outline" size="sm" class="h-7 w-fit text-[11px]" :disabled="bankTestMutation.isPending.value || !draft.questionBank.url" @click="bankTestMutation.mutate()">
            {{ bankTestMutation.isPending.value ? "测试中…" : "测试连接" }}
          </Button>
        </div>
      </section>

      <!-- 邮箱 -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Mail class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[13px] font-semibold">邮箱通知</h2>
            <p class="text-[10.5px] text-muted-foreground">任务完成/出错时发送邮件</p>
          </div>
          <Switch v-model="draft.email.enabled" class="ml-auto" />
        </div>
        <div class="mt-3 grid gap-2.5" :class="draft.email.enabled ? '' : 'opacity-50'">
          <div class="grid grid-cols-[1fr_88px] gap-2.5">
            <div class="grid gap-1">
              <Label class="text-[10.5px]">SMTP 服务器</Label>
              <Input v-model="draft.email.smtpHost" placeholder="smtp.qq.com" :disabled="!draft.email.enabled" class="h-8 text-[11px]" />
            </div>
            <div class="grid gap-1">
              <Label class="text-[10.5px]">端口</Label>
              <Input v-model="emailPortModel" type="number" :disabled="!draft.email.enabled" class="h-8 text-[11px]" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <div class="grid gap-1">
              <Label class="text-[10.5px]">发件账号</Label>
              <Input v-model="draft.email.user" placeholder="xxx@qq.com" :disabled="!draft.email.enabled" class="h-8 text-[11px]" />
            </div>
            <div class="grid gap-1">
              <Label class="text-[10.5px]">密码 / 授权码</Label>
              <Input v-model="draft.email.pass" type="password" autocomplete="off" :disabled="!draft.email.enabled" class="h-8 text-[11px]" />
            </div>
          </div>
          <div class="grid gap-1">
            <Label class="text-[10.5px]">收件人（逗号分隔）</Label>
            <Input v-model="draft.email.to" placeholder="a@x.com, b@y.com" :disabled="!draft.email.enabled" class="h-8 text-[11px]" />
          </div>
        </div>
      </section>

      <!-- 调度 -->
      <section class="panel p-4">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Gauge class="size-4" /></div>
          <div class="min-w-0">
            <h2 class="text-[13px] font-semibold">调度参数</h2>
            <p class="text-[10.5px] text-muted-foreground">提交节奏贴近真实播放可降低风控风险</p>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2.5">
          <div class="grid gap-1">
            <Label class="text-[10.5px]">学时提交间隔（秒）</Label>
            <Input v-model="tickModel" type="number" min="3" max="30" class="h-8 text-[11px]" />
            <p class="text-[9.5px] leading-snug text-muted-foreground">
              每隔几秒向平台提交一次进度。5 秒最接近真实播放，越小越快但更容易触发风控。
            </p>
          </div>
          <div class="grid gap-1">
            <Label class="text-[10.5px]">最大并发账号数（1—10）</Label>
            <Input v-model="concurrencyModel" type="number" min="1" max="10" class="h-8 text-[11px]" />
            <p class="text-[9.5px] leading-snug text-muted-foreground">
              同时跑几个账号的任务。超出的账号会排队等待，直到前面的任务结束。
            </p>
          </div>
          <div class="grid gap-1">
            <Label class="text-[10.5px]">单账号课程并发数（1—5）</Label>
            <Input v-model="courseConcurrencyModel" type="number" min="1" max="5" class="h-8 text-[11px]" />
            <p class="text-[9.5px] leading-snug text-muted-foreground">
              同一个账号同时刷几门课。1 = 逐门课串行；3 = 最多 3 门课同时推进。课程内视频的刷法由任务里的「刷课模式」决定。
            </p>
          </div>
        </div>
        <p class="mt-2 text-[10px] text-muted-foreground">
          两个并发是叠加的：账号之间并行由上一项控制，账号内的课程并行由这一项控制，互不影响。
        </p>
      </section>

      <!-- 访问锁 -->
      <section class="panel p-4 lg:col-span-2">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Lock class="size-4" /></div>
          <div class="min-w-0 flex-1">
            <h2 class="text-[13px] font-semibold">访问锁</h2>
            <p class="text-[10.5px] text-muted-foreground">
              {{ auth.authRequired ? "已启用：面板与接口需凭密码登录" : "未启用：当前仅本机可访问，部署到服务器前务必设置密码" }}
            </p>
          </div>
          <Badge :variant="auth.authRequired ? 'success' : 'outline'">{{ auth.authRequired ? "已启用" : "未启用" }}</Badge>
        </div>
        <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="passwordMutation.mutate()">
          <div class="grid w-64 gap-1">
            <Label class="text-[10.5px]">{{ auth.authRequired ? "修改访问密码" : "设置访问密码" }}</Label>
            <Input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 6 位" required minlength="6" class="h-8 text-[11px]" />
          </div>
          <Button type="submit" size="sm" class="h-8 text-[11px]" :disabled="passwordMutation.isPending.value || !newPassword">
            {{ auth.authRequired ? "修改" : "启用" }}
          </Button>
          <Button
            v-if="auth.authRequired"
            type="button"
            variant="outline"
            size="sm"
            class="h-8 text-[11px]"
            :disabled="disableMutation.isPending.value"
            @click="disableMutation.mutate()"
          ><Ban class="size-3.5" />关闭访问锁</Button>
        </form>
      </section>
    </div>
  </div>
</template>
