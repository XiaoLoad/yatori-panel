<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, reactive, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { Settings } from "@yatori/shared";
import { api } from "@/api/resources";
import { useAuthStore } from "@/stores/auth";
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

const auth = useAuthStore();
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

const queryClient = useQueryClient();
const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });

const form = reactive<Settings>({
  ai: { enabled: false, type: "TONGYI", url: "", model: "", apiKey: "" },
  questionBank: { enabled: false, url: "", key: "" },
  tickSeconds: 5,
  maxAccountsConcurrency: 3,
});

watch(settingsQuery.data, (data) => {
  if (!data) return;
  form.ai = { ...data.ai };
  form.questionBank = { ...data.questionBank };
  form.tickSeconds = data.tickSeconds;
  form.maxAccountsConcurrency = data.maxAccountsConcurrency;
});

const saveMutation = useMutation({
  mutationFn: () => api.saveSettings({ ...form }),
  onSuccess: () => {
    toast.success("设置已保存");
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  },
  onError: (err) => toast.error((err as Error).message),
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

const aiTypeModel = computed({
  get: () => form.ai.type,
  set: (v: string) => {
    form.ai.type = v;
  },
});

const tickModel = computed({
  get: () => String(form.tickSeconds),
  set: (v: string) => {
    const n = Number(v);
    form.tickSeconds = Math.min(30, Math.max(3, Number.isFinite(n) ? n : 5));
  },
});

const concurrencyModel = computed({
  get: () => String(form.maxAccountsConcurrency),
  set: (v: string) => {
    const n = Number(v);
    form.maxAccountsConcurrency = Math.min(10, Math.max(1, Number.isFinite(n) ? n : 3));
  },
});
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">全局设置</h1>
      <p class="mt-1 text-sm text-muted-foreground">AI 答题、题库与调度参数</p>
    </div>
    <Card>
      <CardHeader>
        <CardTitle>访问锁</CardTitle>
        <CardDescription>
          {{
            auth.authRequired
              ? "已启用：面板与接口需凭密码登录后访问（服务器部署必开）"
              : "未启用：当前仅本机可访问。部署到服务器前请务必设置密码"
          }}
        </CardDescription>
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
            关闭访问锁
          </Button>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>AI 答题</CardTitle>
        <CardDescription>任务里选择「AI 答题」时使用此配置；密钥仅存本机</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center gap-3">
          <Switch v-model="form.ai.enabled" />
          <Label class="font-normal">启用 AI 答题</Label>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2">
            <Label>模型类型</Label>
            <Select v-model="aiTypeModel" :options="AI_TYPES" :disabled="!form.ai.enabled" />
          </div>
          <div class="grid gap-2">
            <Label>模型名称</Label>
            <Input v-model="form.ai.model" placeholder="如 qwen-plus" :disabled="!form.ai.enabled" />
          </div>
          <div class="grid gap-2">
            <Label>接口地址</Label>
            <Input v-model="form.ai.url" placeholder="https://..." :disabled="!form.ai.enabled" />
          </div>
          <div class="grid gap-2">
            <Label>API Key</Label>
            <Input
              v-model="form.ai.apiKey"
              type="password"
              placeholder="sk-..."
              autocomplete="off"
              :disabled="!form.ai.enabled"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>外置题库</CardTitle>
        <CardDescription>对接 yatori-go-quesbank 等题库服务的地址</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center gap-3">
          <Switch v-model="form.questionBank.enabled" />
          <Label class="font-normal">启用外置题库</Label>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2">
            <Label>服务地址</Label>
            <Input
              v-model="form.questionBank.url"
              placeholder="http://localhost:8083"
              :disabled="!form.questionBank.enabled"
            />
          </div>
          <div class="grid gap-2">
            <Label>访问密钥</Label>
            <Input
              v-model="form.questionBank.key"
              type="password"
              autocomplete="off"
              :disabled="!form.questionBank.enabled"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>调度参数</CardTitle>
        <CardDescription>与真实播放节奏保持一致可降低风控风险</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4 md:grid-cols-2">
        <div class="grid gap-2">
          <Label>学时提交间隔（秒）</Label>
          <Input v-model="tickModel" type="number" min="3" max="30" />
        </div>
        <div class="grid gap-2">
          <Label>最大同时运行账号数</Label>
          <Input v-model="concurrencyModel" type="number" min="1" max="10" />
        </div>
      </CardContent>
    </Card>

    <div class="flex justify-end">
      <Button :disabled="saveMutation.isPending.value" @click="saveMutation.mutate()">
        {{ saveMutation.isPending.value ? "保存中…" : "保存设置" }}
      </Button>
    </div>
  </div>
</template>
