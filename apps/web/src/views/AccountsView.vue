<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { FileUp, Plus, Users } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { PlatformMeta } from "@yatori/shared";
import { ApiError, type GatewayLogEntry } from "@/api/client";
import { api, type AccountWithSession } from "@/api/resources";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useEventStore } from "@/stores/events";
import AccountCard from "@/components/AccountCard.vue";
import EmptyState from "@/components/EmptyState.vue";

const queryClient = useQueryClient();
const events = useEventStore();
// 网关离线时禁用"添加账号"（添加默认走登录检测）
const gatewayOffline = computed(() => events.gatewayStatus !== null && !events.gatewayStatus.up);

const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms });
const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 50 }),
  refetchInterval: 5000,
});

/** accountUid → 运行中任务 */
const runningByAccount = computed(() => {
  const map: Record<string, NonNullable<typeof jobsQuery.data.value>[number]> = {};
  for (const j of jobsQuery.data.value ?? []) {
    if (j.state === "running") map[j.accountUid] = j;
  }
  return map;
});

// ---------- 表单：字段集由所选平台的 loginFields 驱动 ----------

const dialogOpen = ref(false);
const editingUid = ref<string | null>(null);
const form = reactive({
  platform: "",
  fields: {} as Record<string, string>,
  remark: "",
  proxyUrl: "",
  verify: true,
});
const fieldErrors = reactive<Record<string, string>>({});

const platforms = computed<PlatformMeta[]>(() => platformsQuery.data.value ?? []);
const currentPlatform = computed(() =>
  platforms.value.find((p) => p.key === form.platform),
);

watch(
  () => form.platform,
  () => {
    form.fields = {};
    delete fieldErrors.platform;
  },
);

function clearFieldErrors() {
  for (const k of Object.keys(fieldErrors)) delete fieldErrors[k];
}

function validateForm(): boolean {
  clearFieldErrors();
  const errors: Record<string, string> = {};
  if (!form.platform) errors.platform = "请选择平台";
  for (const f of currentPlatform.value?.loginFields ?? []) {
    if (!f.required) continue;
    // 编辑模式下密码留空表示不修改
    if (editingUid.value && f.key === "password") continue;
    if (!(form.fields[f.key] ?? "").trim()) errors[f.key] = `${f.label}不能为空`;
  }
  Object.assign(fieldErrors, errors);
  return Object.keys(errors).length === 0;
}

function fieldModel(key: string) {
  return computed({
    get: () => form.fields[key] ?? "",
    set: (v: string) => {
      form.fields[key] = v;
      delete fieldErrors[key];
    },
  });
}

const fieldTypes: Record<string, string> = { password: "password", apiKey: "password" };

function openCreate() {
  editingUid.value = null;
  form.platform = platforms.value.find((p) => p.mvp)?.key ?? "";
  form.fields = {};
  form.remark = "";
  form.proxyUrl = "";
  form.verify = true;
  clearFieldErrors();
  dialogOpen.value = true;
}

function openEdit(account: AccountWithSession) {
  editingUid.value = account.uid;
  form.platform = account.platform;
  form.fields = {
    username: account.username,
    password: "",
    url: account.baseUrl ?? "",
  };
  form.remark = account.remark;
  form.proxyUrl = account.proxyUrl ?? "";
  form.verify = false;
  clearFieldErrors();
  dialogOpen.value = true;
}

function submitForm() {
  if (!validateForm()) return;
  saveMutation.mutate();
}

const saveMutation = useMutation({
  mutationFn: async () => {
    const url = form.fields["url"] ?? "";
    const username = form.fields["username"] ?? "";
    const password = form.fields["password"] ?? "";
    if (editingUid.value) {
      await api.updateAccount(editingUid.value, {
        baseUrl: url,
        username,
        password: password || undefined,
        remark: form.remark,
        proxyUrl: form.proxyUrl,
      });
      return null;
    }
    return api.createAccount({
      platform: form.platform,
      baseUrl: url,
      username,
      password,
      remark: form.remark,
      proxyUrl: form.proxyUrl,
      verify: form.verify,
    });
  },
  onSuccess: (result) => {
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["course-progress"] });
    dialogOpen.value = false;
    if (!result) {
      toast.success("账号已更新");
      return;
    }
    if (result.verify?.ok) {
      const filled = result.remark ? `，备注已自动填入「${result.remark}」` : "";
      toast.success(`账号已添加，登录正常，共 ${result.verify.courseCount} 门课程${filled}`);
    } else {
      toast.warning("账号已保存，但登录检测未通过，可稍后在卡片上重试");
    }
  },
  onError: (err) => showError(err as ApiError, "保存失败"),
});

const verifyMutation = useMutation({
  mutationFn: (uid: string) => api.verifyAccount(uid),
  onSuccess: (r) => {
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["course-progress"] });
    if (r.ok) {
      const filled = r.remark ? `，备注「${r.remark}」` : "";
      toast.success(`登录正常，共 ${r.courseCount} 门课程${filled}`);
    } else {
      toast.warning("登录异常，请检查账号信息");
    }
  },
  onError: (err) => showError(err as ApiError, "登录检测失败"),
});

const removeMutation = useMutation({
  mutationFn: (uid: string) => api.deleteAccount(uid),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    toast.success("账号已删除");
  },
  onError: (err) => showError(err as ApiError, "删除失败"),
});

// ---------- config.yaml 导入 ----------

const importOpen = ref(false);
const importText = ref("");
const importFileName = ref("");
const importResult = ref<{ imported: number; skipped: number; failed: { account: string; error: string }[] } | null>(null);

const importMutation = useMutation({
  mutationFn: () => api.importConfig(importText.value),
  onSuccess: (r) => {
    importResult.value = r;
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    if (r.failed.length === 0) {
      toast.success(`导入完成：成功 ${r.imported} 个账号`);
      importOpen.value = false;
      importText.value = "";
      importFileName.value = "";
    }
  },
  onError: (err) => showError(err as ApiError, "导入失败"),
});

function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importFileName.value = file.name;
  void file.text().then((text) => {
    importText.value = text;
  });
}

function submitImport() {
  if (!importText.value.trim()) {
    toast.error("请粘贴 config.yaml 内容或选择文件");
    return;
  }
  importMutation.mutate();
}

// ---------- 失败日志对话框 ----------

const errorDialog = ref<{ title: string; message: string; logs: GatewayLogEntry[] } | null>(null);

function showError(err: ApiError, fallback: string) {
  // 网关离线：错误对话框升级为诊断指引，并提示点击右上角徽章
  if (err.gatewayOffline) {
    errorDialog.value = {
      title: "网关离线",
      message: "网关服务不可达，登录/刷课功能暂不可用。请点击右上角网关徽章查看诊断与修复指引。",
      logs: [],
    };
    return;
  }
  errorDialog.value = {
    title: fallback,
    message: err.message,
    logs: err.logs ?? [],
  };
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">账号管理</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          每个账号一张卡片：点「开始刷课」即按默认策略刷全部未完成课程
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" @click="importOpen = true">
          <FileUp />导入 config.yaml
        </Button>
        <Button
          @click="openCreate"
          :disabled="gatewayOffline"
          :title="gatewayOffline ? '网关离线——请先修复网关' : undefined"
        ><Plus />添加账号</Button>
      </div>
    </div>

    <div v-if="accountsQuery.isLoading.value" class="space-y-4">
      <Skeleton v-for="i in 2" :key="i" class="h-44 rounded-xl" />
    </div>

    <EmptyState
      v-else-if="!accountsQuery.data.value?.length"
      :icon="Users"
      title="还没有账号"
      description="添加一个平台账号，即可一键开始刷课"
      action-label="添加账号"
      @action="openCreate"
    />

    <template v-else>
      <AccountCard
        v-for="account in accountsQuery.data.value"
        :key="account.uid"
        :account="account"
        :running-job="runningByAccount[account.uid] ?? null"
        @edit="openEdit"
        @remove="(a) => removeMutation.mutate(a.uid)"
        @verify="(uid) => verifyMutation.mutate(uid)"
      />
    </template>

    <!-- 添加/编辑：字段集来自 /platforms 的 loginFields，新平台无需改这里 -->
    <Dialog v-model:open="dialogOpen">
      <form class="grid gap-4" @submit.prevent="submitForm">
        <div class="grid gap-1.5">
          <DialogTitle>{{ editingUid ? "编辑账号" : "添加账号" }}</DialogTitle>
          <DialogDescription>
            字段与能力由网关自动下发；备注留空将自动填入平台姓名
          </DialogDescription>
        </div>

        <div class="grid gap-2">
          <Label>平台</Label>
          <Select
            v-model="form.platform"
            :options="platforms.map((p) => ({ value: p.key, label: `${p.name}${p.mvp ? '' : '（暂未适配面板）'}` }))"
            placeholder="选择平台"
            :disabled="!!editingUid"
            :class="fieldErrors.platform ? 'border-destructive focus-visible:ring-destructive' : ''"
          />
          <p v-if="fieldErrors.platform" class="text-xs text-red-500">{{ fieldErrors.platform }}</p>
        </div>

        <div
          v-for="field in currentPlatform?.loginFields ?? []"
          :key="field.key"
          class="grid gap-2"
        >
          <Label>{{ field.label }}<span v-if="field.required" class="text-red-500"> *</span></Label>
          <Input
            v-model="fieldModel(field.key).value"
            :type="fieldTypes[field.key] ?? 'text'"
            :placeholder="field.placeholder"
            autocomplete="off"
            :class="fieldErrors[field.key] ? 'border-destructive focus-visible:ring-destructive' : ''"
          />
          <p v-if="fieldErrors[field.key]" class="text-xs text-red-500">{{ fieldErrors[field.key] }}</p>
        </div>

        <div class="grid gap-2">
          <Label>备注</Label>
          <Input v-model="form.remark" placeholder="留空自动填入平台姓名" />
        </div>

        <div class="grid gap-2">
          <Label>代理地址（可选）</Label>
          <Input v-model="form.proxyUrl" placeholder="http://127.0.0.1:7890" autocomplete="off" />
          <p class="text-xs text-muted-foreground">刷课流量经此代理出网（HTTP 代理），留则直连</p>
        </div>

        <div v-if="!editingUid" class="flex items-center gap-3">
          <Switch v-model="form.verify" />
          <Label class="font-normal">保存后立即登录检测</Label>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" @click="dialogOpen = false">取消</Button>
          <Button type="submit" :disabled="saveMutation.isPending.value">
            {{ saveMutation.isPending.value ? "保存中…" : "保存" }}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>

    <!-- 失败详情（含网关回传的 OCR 过程日志） -->
    <Dialog :open="!!errorDialog" @update:open="errorDialog = null">
      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <DialogTitle>{{ errorDialog?.title }}</DialogTitle>
          <DialogDescription>{{ errorDialog?.message }}</DialogDescription>
        </div>
        <pre
          v-if="errorDialog?.logs?.length"
          class="max-h-64 overflow-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-300"
        >{{ errorDialog.logs.map((l) => `[${l.time}] ${l.message}`).join("\n") }}</pre>
        <DialogFooter>
          <Button variant="outline" @click="errorDialog = null">知道了</Button>
        </DialogFooter>
      </div>
    </Dialog>

    <!-- config.yaml 批量导入 -->
    <Dialog v-model:open="importOpen">
      <form class="grid gap-4" @submit.prevent="submitImport">
        <div class="grid gap-1.5">
          <DialogTitle>导入 config.yaml</DialogTitle>
          <DialogDescription>
            兼容 yatori-go-console 的配置格式，自动导入其中全部账号（密码加密入库）
          </DialogDescription>
        </div>
        <div class="grid gap-2">
          <Label>选择文件</Label>
          <Input
            type="file"
            accept=".yaml,.yml,.txt"
            class="cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs"
            @change="onImportFile"
          />
        </div>
        <div class="grid gap-2">
          <Label>或直接粘贴内容</Label>
          <textarea
            v-model="importText"
            rows="8"
            spellcheck="false"
            class="w-full rounded-md border border-input bg-transparent p-3 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="users:
  - accountType: YINGHUA
    url: https://xxx.suwankj.com
    account: '2025xxxx'
    password: 'xxxx'"
          />
        </div>

        <div v-if="importResult" class="rounded-md border bg-muted/40 p-3 text-sm">
          <p>
            导入 <span class="font-semibold text-emerald-500">{{ importResult.imported }}</span> 个
            · 跳过 {{ importResult.skipped }} 个
            · 失败 {{ importResult.failed.length }} 个
          </p>
          <p v-for="f in importResult.failed" :key="f.account" class="text-xs text-red-500">
            {{ f.account }}：{{ f.error }}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" @click="importOpen = false">取消</Button>
          <Button type="submit" :disabled="importMutation.isPending.value || !importText.trim()">
            {{ importMutation.isPending.value ? "导入中…" : "开始导入" }}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  </div>
</template>
