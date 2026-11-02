<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { FileUp, Plus } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { PlatformMeta } from "@yatori/shared";
import type { AccountWithSession } from "@/api/resources";
import { ApiError } from "@/api/client";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const props = defineProps<{ open: boolean; account?: AccountWithSession | null }>();
const emit = defineEmits<{ "update:open": [boolean]; saved: [] }>();

const queryClient = useQueryClient();
const tab = ref<"single" | "import">("single");
const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms });

const form = reactive({
  platform: "",
  fields: {} as Record<string, string>,
  remark: "",
  proxyUrl: "",
  verify: true,
});
const fieldErrors = reactive<Record<string, string>>({});
const editing = computed(() => !!props.account);

const platforms = computed<PlatformMeta[]>(() => platformsQuery.data.value ?? []);
const currentPlatform = computed(() => platforms.value.find((p) => p.key === form.platform));
const fieldTypes: Record<string, string> = { password: "password", apiKey: "password" };

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    tab.value = "single";
    clearFieldErrors();
    if (props.account) {
      form.platform = props.account.platform;
      form.fields = {
        username: props.account.username,
        password: "",
        url: props.account.baseUrl ?? "",
      };
      form.remark = props.account.remark;
      form.proxyUrl = props.account.proxyUrl ?? "";
      form.verify = false;
    } else {
      form.platform = platforms.value.find((p) => p.mvp)?.key ?? "";
      form.fields = {};
      form.remark = "";
      form.proxyUrl = "";
      form.verify = true;
    }
  },
);

// 平台列表异步到达时补充默认平台（首个适配面板的平台）
watch(platforms, (list) => {
  if (props.open && !editing.value && !form.platform) {
    form.platform = list.find((p) => p.mvp)?.key ?? "";
  }
});

function onPlatformChange() {
  form.fields = {};
  delete fieldErrors.platform;
}

function clearFieldErrors() {
  for (const k of Object.keys(fieldErrors)) delete fieldErrors[k];
}

function validate(): boolean {
  clearFieldErrors();
  const errors: Record<string, string> = {};
  if (!form.platform) errors.platform = "请选择平台";
  for (const f of currentPlatform.value?.loginFields ?? []) {
    if (!f.required) continue;
    if (editing.value && f.key === "password") continue;
    if (!(form.fields[f.key] ?? "").trim()) errors[f.key] = `${f.label}不能为空`;
  }
  Object.assign(fieldErrors, errors);
  return Object.keys(errors).length === 0;
}

const saveMutation = useMutation({
  mutationFn: async () => {
    const url = form.fields["url"] ?? "";
    const username = form.fields["username"] ?? "";
    const password = form.fields["password"] ?? "";
    if (props.account) {
      await api.updateAccount(props.account.uid, {
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
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    emit("update:open", false);
    emit("saved");
    if (!result) {
      toast.success("账号已更新");
      return;
    }
    if (result.verify?.ok) {
      const filled = result.remark ? `，备注已自动填入「${result.remark}」` : "";
      toast.success(`账号已添加，登录正常，共 ${result.verify.courseCount} 门课程${filled}`);
    } else {
      toast.warning("账号已保存，但登录检测未通过，可稍后在列表中重试");
    }
  },
  onError: (err) => toastError(err as ApiError, "保存失败"),
});

function submit() {
  if (!validate()) return;
  saveMutation.mutate();
}

// ---------- 批量导入 ----------
const importText = ref("");
const importFileName = ref("");
const importResult = ref<{ imported: number; skipped: number; failed: { account: string; error: string }[] } | null>(null);

const importMutation = useMutation({
  mutationFn: () => api.importConfig(importText.value),
  onSuccess: (r) => {
    importResult.value = r;
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    if (r.failed.length === 0) {
      toast.success(`导入完成：成功 ${r.imported} 个账号`);
      emit("update:open", false);
      importText.value = "";
      importFileName.value = "";
    }
  },
  onError: (err) => toastError(err as ApiError, "导入失败"),
});

function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importFileName.value = file.name;
  void file.text().then((text) => (importText.value = text));
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
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <div class="grid gap-4">
      <div class="grid gap-1">
        <DialogTitle>{{ editing ? "编辑账号" : "添加账号" }}</DialogTitle>
        <DialogDescription>
          字段由网关按平台下发；备注留空时自动填入平台姓名
        </DialogDescription>
      </div>

      <div v-if="!editing" class="flex gap-1 rounded-lg bg-muted p-1">
        <button
          :class="cn('flex-1 rounded-md px-3 py-1.5 text-xs transition-colors', tab === 'single' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
          @click="tab = 'single'"
        ><Plus class="mr-1 inline size-3.5" />单个添加</button>
        <button
          :class="cn('flex-1 rounded-md px-3 py-1.5 text-xs transition-colors', tab === 'import' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
          @click="tab = 'import'"
        ><FileUp class="mr-1 inline size-3.5" />批量导入</button>
      </div>

      <form v-if="tab === 'single'" class="grid gap-3.5" @submit.prevent="submit">
        <div class="grid gap-1.5">
          <Label>平台</Label>
          <Select
            v-model="form.platform"
            :options="platforms.map((p) => ({ value: p.key, label: `${p.name}${p.mvp ? '' : '（暂未适配面板）'}` }))"
            placeholder="选择平台"
            :disabled="editing"
            @update:model-value="onPlatformChange"
          />
          <p v-if="fieldErrors.platform" class="text-[13.5px] text-red-500">{{ fieldErrors.platform }}</p>
        </div>

        <div v-for="field in currentPlatform?.loginFields ?? []" :key="field.key" class="grid gap-1.5">
          <Label>{{ field.label }}<span v-if="field.required" class="text-red-500"> *</span></Label>
          <Input
            v-model="fieldModel(field.key).value"
            :type="fieldTypes[field.key] ?? 'text'"
            :placeholder="field.placeholder"
            autocomplete="off"
          />
          <p v-if="fieldErrors[field.key]" class="text-[13.5px] text-red-500">{{ fieldErrors[field.key] }}</p>
          <p v-else-if="field.key === 'url'" class="text-[12.5px] text-muted-foreground">
            可粘贴带 <code class="mono rounded bg-muted px-1">/user</code> 的登录页完整地址，保存时会自动归一化为平台根地址
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5">
            <Label>备注</Label>
            <Input v-model="form.remark" placeholder="留空自动填入平台姓名" />
          </div>
          <div class="grid gap-1.5">
            <Label>代理地址（可选）</Label>
            <Input v-model="form.proxyUrl" placeholder="http://127.0.0.1:7890" autocomplete="off" />
          </div>
        </div>

        <div v-if="!editing" class="flex items-center gap-2.5">
          <Switch v-model="form.verify" />
          <Label class="font-normal text-muted-foreground">保存后立即登录检测</Label>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="emit('update:open', false)">取消</Button>
          <Button type="submit" :disabled="saveMutation.isPending.value">
            {{ saveMutation.isPending.value ? "保存中…" : "保存" }}
          </Button>
        </DialogFooter>
      </form>

      <form v-else class="grid gap-3.5" @submit.prevent="importMutation.mutate()">
        <div class="grid gap-1.5">
          <Label>config.yaml 文件</Label>
          <Input
            type="file"
            accept=".yaml,.yml,.txt"
            class="cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs"
            @change="onFile"
          />
          <p class="text-[13px] text-muted-foreground">
            {{ importFileName || "兼容 yatori-go-console 的 users 配置，密码加密入库" }}
          </p>
        </div>
        <div class="grid gap-1.5">
          <Label>或直接粘贴内容</Label>
          <textarea
            v-model="importText"
            rows="7"
            spellcheck="false"
            class="w-full rounded-lg border border-input bg-transparent p-3 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="users:
  - accountType: YINGHUA
    url: https://xxx.suwankj.com
    account: '2025xxxx'
    password: 'xxxx'"
          />
        </div>

        <div v-if="importResult" class="rounded-lg border border-border bg-muted/40 p-3 text-xs">
          导入 <span class="font-semibold text-emerald-500">{{ importResult.imported }}</span> 个
          · 跳过 {{ importResult.skipped }} 个 · 失败
          <span :class="importResult.failed.length ? 'text-red-500' : ''">{{ importResult.failed.length }}</span> 个
          <p v-for="f in importResult.failed" :key="f.account" class="mt-1 text-[13px] text-red-500">
            {{ f.account }}：{{ f.error }}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="emit('update:open', false)">取消</Button>
          <Button type="submit" :disabled="importMutation.isPending.value || !importText.trim()">
            {{ importMutation.isPending.value ? "导入中…" : "开始导入" }}
          </Button>
        </DialogFooter>
      </form>
    </div>
  </Dialog>
</template>
