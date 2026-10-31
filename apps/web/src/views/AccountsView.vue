<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { PlatformMeta } from "@yatori/shared";
import { ApiError, type GatewayLogEntry } from "@/api/client";
import { api, type AccountWithSession } from "@/api/resources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const queryClient = useQueryClient();

const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms });

// ---------- 表单状态：字段集由所选平台的 loginFields 驱动 ----------

const dialogOpen = ref(false);
const editingUid = ref<string | null>(null);
const form = reactive({
  platform: "",
  fields: {} as Record<string, string>,
  remark: "",
  verify: true,
});

const platforms = computed<PlatformMeta[]>(() => platformsQuery.data.value ?? []);
const currentPlatform = computed(() =>
  platforms.value.find((p) => p.key === form.platform),
);

watch(
  () => form.platform,
  () => {
    form.fields = {};
  },
);

function openCreate() {
  editingUid.value = null;
  form.platform = platforms.value.find((p) => p.mvp)?.key ?? "";
  form.fields = {};
  form.remark = "";
  form.verify = true;
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
  form.verify = false;
  dialogOpen.value = true;
}

function fieldModel(key: string) {
  return computed({
    get: () => form.fields[key] ?? "",
    set: (v: string) => {
      form.fields[key] = v;
    },
  });
}

const fieldTypes: Record<string, string> = { password: "password", apiKey: "password" };

// ---------- 提交与失败日志展示 ----------

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
      });
      return null;
    }
    return api.createAccount({
      platform: form.platform,
      baseUrl: url,
      username,
      password,
      remark: form.remark,
      verify: form.verify,
    });
  },
  onSuccess: (result) => {
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    dialogOpen.value = false;
    if (!result) {
      toast.success("账号已更新");
      return;
    }
    if (result.verify?.ok) {
      toast.success(`账号已添加，登录正常，共 ${result.verify.courseCount} 门课程`);
    } else {
      toast.warning("账号已保存，但登录检测未通过，可稍后在列表中重试");
    }
  },
  onError: (err) => showError(err as ApiError, "保存失败"),
});

const verifyMutation = useMutation({
  mutationFn: (uid: string) => api.verifyAccount(uid),
  onSuccess: (r) => {
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    if (r.ok) toast.success(`登录正常，共 ${r.courseCount} 门课程`);
    else toast.warning("登录异常，请检查账号信息");
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

// ---------- 失败日志对话框 ----------

const errorDialog = ref<{ title: string; message: string; logs: GatewayLogEntry[] } | null>(null);

function showError(err: ApiError, fallback: string) {
  errorDialog.value = {
    title: fallback,
    message: err.message,
    logs: err.logs ?? [],
  };
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
        密码加密存储在本机数据库中；「学校平台地址」填学校英华站点的根地址（不含 /user）。
      </p>
      <Button @click="openCreate">
        <Plus />添加账号
      </Button>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>账号列表</CardTitle>
        <CardDescription>共 {{ accountsQuery.data.value?.length ?? 0 }} 个账号</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>平台</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>备注</TableHead>
              <TableHead>最近检测</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="!accountsQuery.data.value?.length">
              <TableCell colspan="5" class="text-center text-muted-foreground">
                暂无账号，点击右上角添加
              </TableCell>
            </TableRow>
            <TableRow v-for="account in accountsQuery.data.value" :key="account.uid">
              <TableCell>
                <Badge variant="secondary">{{ account.platformName }}</Badge>
              </TableCell>
              <TableCell>
                <div class="font-medium">{{ account.username }}</div>
                <div v-if="account.baseUrl" class="text-xs text-muted-foreground">
                  {{ account.baseUrl }}
                </div>
              </TableCell>
              <TableCell>{{ account.remark || "-" }}</TableCell>
              <TableCell>
                <div v-if="account.lastVerifyOk === null || account.lastVerifyOk === undefined" class="text-muted-foreground">
                  未检测
                </div>
                <div v-else class="flex items-center gap-2">
                  <Badge :variant="account.lastVerifyOk === 1 ? 'success' : 'destructive'">
                    {{ account.lastVerifyOk === 1 ? "正常" : "失败" }}
                  </Badge>
                  <span class="text-xs text-muted-foreground">
                    {{ account.lastVerifyAt ? new Date(account.lastVerifyAt).toLocaleString() : "" }}
                  </span>
                </div>
              </TableCell>
              <TableCell class="text-right">
                <div class="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="登录检测"
                    :disabled="verifyMutation.isPending.value"
                    @click="verifyMutation.mutate(account.uid)"
                  >
                    <RefreshCw class="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="编辑" @click="openEdit(account)">
                    <Pencil class="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="删除"
                    @click="removeMutation.mutate(account.uid)"
                  >
                    <Trash2 class="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <!-- 添加/编辑：字段集来自 /platforms 的 loginFields，新平台无需改这里 -->
    <Dialog v-model:open="dialogOpen">
      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <DialogTitle>{{ editingUid ? "编辑账号" : "添加账号" }}</DialogTitle>
          <DialogDescription>
            平台能力与字段由网关自动下发
          </DialogDescription>
        </div>

        <div class="grid gap-2">
          <Label>平台</Label>
          <Select
            v-model="form.platform"
            :options="platforms.map((p) => ({ value: p.key, label: `${p.name}${p.mvp ? '' : '（暂未适配面板）'}` }))"
            placeholder="选择平台"
            :disabled="!!editingUid"
          />
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
            :required="field.required"
            autocomplete="off"
          />
        </div>

        <div class="grid gap-2">
          <Label>备注</Label>
          <Input v-model="form.remark" placeholder="可选，方便区分账号" />
        </div>

        <div v-if="!editingUid" class="flex items-center gap-3">
          <Switch v-model="form.verify" />
          <Label class="font-normal">保存后立即登录检测</Label>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="dialogOpen = false">取消</Button>
          <Button :disabled="saveMutation.isPending.value" @click="saveMutation.mutate()">
            {{ saveMutation.isPending.value ? "保存中…" : "保存" }}
          </Button>
        </DialogFooter>
      </div>
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
  </div>
</template>
