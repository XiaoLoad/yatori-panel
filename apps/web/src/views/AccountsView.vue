<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-vue-next";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import AccountProgressCell from "@/components/AccountProgressCell.vue";
import EmptyState from "@/components/EmptyState.vue";
import { relativeTime } from "@/lib/utils";

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
      const filled = result.remark ? `，备注已自动填入「${result.remark}」` : "";
      toast.success(`账号已添加，登录正常，共 ${result.verify.courseCount} 门课程${filled}`);
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
    <div class="flex items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">账号管理</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          密码加密存储在本机；备注留空将自动填入平台上的真实姓名
        </p>
      </div>
      <Button @click="openCreate"><Plus />添加账号</Button>
    </div>

    <Card>
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="space-y-1">
          <CardTitle class="text-base">账号列表</CardTitle>
          <CardDescription>共 {{ accountsQuery.data.value?.length ?? 0 }} 个账号</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          :disabled="verifyMutation.isPending.value"
          @click="accountsQuery.refetch()"
        >
          <RefreshCw />刷新
        </Button>
      </CardHeader>
      <CardContent>
        <div v-if="accountsQuery.isLoading.value" class="space-y-2">
          <Skeleton v-for="i in 3" :key="i" class="h-12 w-full" />
        </div>
        <EmptyState
          v-else-if="!accountsQuery.data.value?.length"
          :icon="Users"
          title="还没有账号"
          description="添加一个平台账号，即可开始刷课"
          action-label="添加账号"
          @action="openCreate"
        />
        <div v-else class="overflow-x-auto">
          <Table class="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead class="w-28">平台</TableHead>
                <TableHead>账号</TableHead>
                <TableHead class="w-32">姓名 / 备注</TableHead>
                <TableHead class="w-52">课程进度</TableHead>
                <TableHead class="w-36">最近检测</TableHead>
                <TableHead class="w-28 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="account in accountsQuery.data.value" :key="account.uid">
                <TableCell>
                  <Badge variant="secondary">{{ account.platformName }}</Badge>
                </TableCell>
                <TableCell class="min-w-0">
                  <div class="truncate font-medium">{{ account.username }}</div>
                  <div v-if="account.baseUrl" class="truncate text-xs text-muted-foreground">
                    {{ account.baseUrl }}
                  </div>
                </TableCell>
                <TableCell>
                  <span v-if="account.remark" class="font-medium">{{ account.remark }}</span>
                  <span v-else class="text-muted-foreground">-</span>
                </TableCell>
                <TableCell>
                  <AccountProgressCell :account="account" />
                </TableCell>
                <TableCell>
                  <div v-if="account.lastVerifyOk === null || account.lastVerifyOk === undefined" class="text-muted-foreground">
                    未检测
                  </div>
                  <div v-else class="flex items-center gap-2">
                    <Badge :variant="account.lastVerifyOk === 1 ? 'success' : 'destructive'">
                      {{ account.lastVerifyOk === 1 ? "正常" : "失败" }}
                    </Badge>
                    <span class="whitespace-nowrap text-xs text-muted-foreground">
                      {{ relativeTime(account.lastVerifyAt) }}
                    </span>
                  </div>
                </TableCell>
                <TableCell class="text-right">
                  <div class="flex justify-end gap-0.5">
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
                      class="text-destructive hover:text-destructive"
                      @click="removeMutation.mutate(account.uid)"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- 添加/编辑：字段集来自 /platforms 的 loginFields，新平台无需改这里 -->
    <Dialog v-model:open="dialogOpen">
      <div class="grid gap-4">
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
          <Input v-model="form.remark" placeholder="留空自动填入平台姓名" />
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
