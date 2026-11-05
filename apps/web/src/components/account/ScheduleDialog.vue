<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { AccountVO, ScheduleScope, ScheduleVO } from "@yatori/shared";
import { accountDisplayLabel, siteTagsFor } from "@yatori/shared";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronDown, Minus } from "lucide-vue-next";
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toastError } from "@/lib/errors";
import { animateCollapse } from "@/lib/collapse";
import { cn } from "@/lib/utils";

const props = defineProps<{
  open: boolean;
  accounts: AccountVO[];
  preselected?: string[];
  /** 传入即为编辑模式，表单以该规则回填 */
  schedule?: ScheduleVO | null;
}>();

const emit = defineEmits<{ "update:open": [boolean]; saved: [] }>();

const queryClient = useQueryClient();
const scope = ref<ScheduleScope>("accounts");
const name = ref("");
const selected = ref<string[]>([]);
const days = ref<number[]>([1, 2, 3, 4, 5]);
const startTime = ref("20:30");
const endTime = ref("22:30");
const stopMode = ref<"finish_current" | "immediate">("finish_current");
const videoModeModel = ref("1");
const answerSource = ref<"off" | "ai" | "bank">("off");
const submitMode = ref<"off" | "direct" | "smart">("off");

const WEEK = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

const isEdit = computed(() => !!props.schedule);

// ---------- 人 → 站点：同学号同平台多站点收敛为人级芯片，可展开精调 ----------
interface PersonGroup {
  key: string;
  accounts: AccountVO[];
  ambiguous: boolean;
  siteTags: Map<string, string>;
  /** 展示名：备注（或学号），歧义时追加首个站点标签外的通用形式由模板拼接 */
  label: string;
}

const allSiteTags = computed(() => siteTagsFor(props.accounts));

const personGroups = computed<PersonGroup[]>(() => {
  const groups: PersonGroup[] = [];
  const byKey = new Map<string, PersonGroup>();
  for (const a of props.accounts) {
    const key = `${a.platform}|${a.username}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, accounts: [], ambiguous: false, siteTags: new Map(), label: "" };
      byKey.set(key, g);
      groups.push(g);
    }
    g.accounts.push(a);
  }
  for (const g of groups) {
    g.ambiguous = g.accounts.length > 1;
    if (g.ambiguous) g.siteTags = siteTagsFor(g.accounts);
    g.label = accountDisplayLabel(g.accounts[0]!, g.ambiguous ? undefined : allSiteTags.value.get(g.accounts[0]!.uid));
  }
  return groups;
});

const expandedPerson = ref<string | null>(null);
const expandedPersonAccounts = computed(
  () => personGroups.value.find((g) => g.key === expandedPerson.value)?.accounts ?? [],
);

function personState(g: PersonGroup): "all" | "none" | "partial" {
  const picked = g.accounts.filter((a) => selected.value.includes(a.uid)).length;
  if (picked === 0) return "none";
  return picked === g.accounts.length ? "all" : "partial";
}

/** 绑定的单账号发生变化后，课程范围选择随之失效（仅单账号规则可指定课程） */
function resetCourseIfAccountChanged(singleBefore: string | null) {
  const singleAfter = singleAccount.value ? selectedUid.value : null;
  if (singleAfter !== singleBefore) {
    courseMode.value = "all";
    picked.value = [];
  }
}

/** 点人芯片主体：选中/取消该人全部站点 */
function togglePerson(g: PersonGroup) {
  const before = singleAccount.value ? selectedUid.value : null;
  const uids = g.accounts.map((a) => a.uid);
  selected.value = personState(g) === "none"
    ? [...new Set([...selected.value, ...uids])]
    : selected.value.filter((u) => !uids.includes(u));
  resetCourseIfAccountChanged(before);
}

function togglePersonExpand(g: PersonGroup) {
  expandedPerson.value = expandedPerson.value === g.key ? null : g.key;
}

function toggleSiteAccount(uid: string) {
  const before = singleAccount.value ? selectedUid.value : null;
  selected.value = selected.value.includes(uid)
    ? selected.value.filter((x) => x !== uid)
    : [...selected.value, uid];
  resetCourseIfAccountChanged(before);
}

/** 人级芯片的三态指示块（纯视觉，不用 Checkbox 组件以避免 label 点击双触发） */
const personMarkClass = (state: "all" | "none" | "partial") =>
  cn(
    "grid size-[15px] shrink-0 place-items-center rounded-[4px] border",
    state === "none"
      ? "border-input bg-card text-transparent"
      : "border-primary/60 bg-primary text-primary-foreground",
  );

/** 指定课程仅对「绑定单个账号」的规则开放 */
const singleAccount = computed(() => scope.value === "accounts" && selected.value.length === 1);
const selectedUid = computed(() => (singleAccount.value ? selected.value[0]! : ""));
const courseMode = ref<"all" | "pick">("all");
const picked = ref<string[]>([]);

const coursesQuery = useQuery({
  queryKey: computed(() => ["schedule-courses", selectedUid.value]),
  queryFn: () => api.courses(selectedUid.value),
  enabled: computed(() => props.open && singleAccount.value && courseMode.value === "pick"),
  staleTime: 30_000,
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const s = props.schedule;
    if (s) {
      scope.value = s.scope;
      name.value = s.name;
      selected.value = [...s.accountUids];
      courseMode.value = s.courseIds.length > 0 && s.accountUids.length === 1 && s.scope === "accounts" ? "pick" : "all";
      picked.value = courseMode.value === "pick" ? [...s.courseIds] : [];
      days.value = parseDaysOfCron(s.cron);
      const parts = s.cron.trim().split(/\s+/);
      startTime.value = `${(parts[1] ?? "0").padStart(2, "0")}:${(parts[0] ?? "0").padStart(2, "0")}`;
      endTime.value = s.endTime ?? "";
      stopMode.value = s.stopMode;
      videoModeModel.value = String(s.videoMode);
      answerSource.value = s.answerSource;
      submitMode.value = s.submitMode;
    } else {
      scope.value = "accounts";
      name.value = "";
      selected.value = [...(props.preselected ?? [])];
      courseMode.value = "all";
      picked.value = [];
      days.value = [1, 2, 3, 4, 5];
      startTime.value = "20:30";
      endTime.value = "22:30";
      stopMode.value = "finish_current";
      videoModeModel.value = "1";
      answerSource.value = "off";
      submitMode.value = "off";
    }
  },
);

/** 从 cron 周字段解析勾选的星期：支持 *（全选）、逗号列表与 a-b 区间 */
function parseDaysOfCron(cron: string): number[] {
  const dow = cron.trim().split(/\s+/)[4] ?? "*";
  if (dow === "*") return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const seg of dow.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(seg);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d += 1) out.add(d % 7);
    } else if (/^\d+$/.test(seg)) {
      out.add(Number(seg) % 7);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function setScope(next: ScheduleScope) {
  if (scope.value === next) return;
  scope.value = next;
  // 作用域变化后课程选择失效，一并重置
  courseMode.value = "all";
  picked.value = [];
}

function toggleCourse(id: string) {
  picked.value = picked.value.includes(id)
    ? picked.value.filter((x) => x !== id)
    : [...picked.value, id];
}

// ---------- 折叠展开动效（课程范围区块与选课列表） ----------

function onSectionEnter(el: Element, done: () => void): void {
  animateCollapse(el, "enter", done);
}
function onSectionLeave(el: Element, done: () => void): void {
  animateCollapse(el, "leave", done);
}
function onPickerEnter(el: Element, done: () => void): void {
  animateCollapse(el, "enter", done, true);
}
function onPickerLeave(el: Element, done: () => void): void {
  animateCollapse(el, "leave", done, true);
}

const showModeHelp = ref(false);

function toggleDay(d: number) {
  days.value = days.value.includes(d)
    ? days.value.filter((x) => x !== d)
    : [...days.value, d];
}

const cron = computed(() => {
  const [h, m] = startTime.value.split(":").map(Number);
  const dow = days.value.length === 7 ? "*" : [...days.value].sort((a, b) => a - b).join(",");
  return `${m ?? 0} ${h ?? 0} * * ${dow || "*"}`;
});

const preview = computed(() => {
  const start = startTime.value;
  return endTime.value ? `每天 ${start} 开始，${endTime.value} 停止` : `每天 ${start} 开始（不自动停止）`;
});

const mutation = useMutation({
  mutationFn: () => {
    const payload = {
      name: name.value.trim(),
      scope: scope.value,
      accountUids: scope.value === "all" ? [] : selected.value,
      courseIds: courseMode.value === "pick" ? picked.value : [],
      cron: cron.value,
      endTime: endTime.value || undefined,
      stopMode: stopMode.value,
      videoMode: Number(videoModeModel.value) as 1 | 2 | 3,
      answerSource: answerSource.value,
      submitMode: submitMode.value,
    };
    return props.schedule
      ? api.updateSchedule(props.schedule.id, payload)
      : api.createSchedule(payload);
  },
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["schedules"] });
    toast.success(isEdit.value ? "定时规则已保存" : "定时规则已创建，后台常驻生效");
    emit("update:open", false);
    emit("saved");
  },
  onError: (err) => toastError(err, isEdit.value ? "保存定时规则失败" : "创建定时规则失败"),
});

function submit() {
  if (scope.value === "accounts" && selected.value.length === 0) {
    toast.error("请至少选择一个账号");
    return;
  }
  if (singleAccount.value && courseMode.value === "pick" && picked.value.length === 0) {
    toast.error("请至少选择一门课程");
    return;
  }
  if (days.value.length === 0) {
    toast.error("请至少选择一天");
    return;
  }
  if (endTime.value) {
    const [sh, sm] = startTime.value.split(":").map(Number);
    const [eh, em] = endTime.value.split(":").map(Number);
    if ((eh ?? 0) * 60 + (em ?? 0) <= (sh ?? 0) * 60 + (sm ?? 0)) {
      toast.error("结束时间必须晚于开始时间（不支持跨天，避免通宵运行）");
      return;
    }
  }
  mutation.mutate();
}
</script>

<template>
  <Dialog :open="open" class="sm:max-w-2xl" @update:open="emit('update:open', $event)">
    <DialogHeader>
      <DialogTitle>{{ isEdit ? "编辑定时规则" : "新建定时规则" }}</DialogTitle>
      <DialogDescription>作用于哪些账号、什么时间运行、以什么策略刷课</DialogDescription>
    </DialogHeader>

    <DialogBody class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <!-- 左列：作用于谁 -->
      <div class="grid content-start gap-3">
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium tracking-wide text-muted-foreground">作用于谁</span>
          <span class="h-px flex-1 bg-border" />
        </div>

        <div class="grid gap-1.5">
          <Label>规则名称</Label>
          <Input v-model="name" placeholder="如：晚间批量刷课（留空则按时间命名）" />
        </div>

        <div class="grid gap-1.5">
          <Label>作用范围</Label>
          <div class="flex gap-1 rounded-lg bg-muted p-1">
            <button
              :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', scope === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
              @click="setScope('all')"
            >全部账号</button>
            <button
              :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', scope === 'accounts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
              @click="setScope('accounts')"
            >指定账号</button>
          </div>
        </div>

        <div v-if="scope === 'all'" class="grid gap-1.5">
          <div class="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[13px] text-muted-foreground">
            到点时自动作用于当时<strong class="text-foreground">所有启用中</strong>的账号——之后新增账号无需修改本规则，删除账号自动排除
          </div>
        </div>
        <div v-else class="grid gap-1.5">
          <Label>应用到账号（{{ selected.length }}）</Label>
          <div class="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
            <div
              v-for="g in personGroups"
              :key="g.key"
              :class="cn(
                'flex items-center overflow-hidden rounded-full border transition-colors',
                personState(g) === 'none'
                  ? 'border-border text-muted-foreground hover:text-foreground'
                  : 'border-primary/40 bg-primary/10 text-primary',
              )"
            >
              <button class="flex items-center gap-1.5 py-1 pl-2 pr-1.5 text-[13.5px]" @click="togglePerson(g)">
                <span :class="personMarkClass(personState(g))">
                  <Minus v-if="personState(g) === 'partial'" class="size-2.5" :stroke-width="3" />
                  <Check v-else-if="personState(g) === 'all'" class="size-2.5" :stroke-width="3" />
                </span>
                {{ g.label }}<template v-if="g.ambiguous">&nbsp;· {{ g.accounts.length }} 站点</template>
              </button>
              <button
                v-if="g.ambiguous"
                class="grid h-6 w-6 place-items-center rounded-full hover:bg-accent/50"
                :title="expandedPerson === g.key ? '收起站点' : '按站点选择'"
                @click.stop="togglePersonExpand(g)"
              >
                <ChevronDown class="size-3.5 transition-transform" :class="expandedPerson === g.key ? 'rotate-180' : ''" />
              </button>
            </div>
          </div>
          <Transition :css="false" @enter="onPickerEnter" @leave="onPickerLeave">
            <div v-if="expandedPerson" class="rounded-lg border border-border p-2">
              <div
                v-for="a in expandedPersonAccounts"
                :key="a.uid"
                class="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40"
              >
                <Checkbox :model-value="selected.includes(a.uid)" @update:model-value="toggleSiteAccount(a.uid)" />
                <span class="min-w-0 flex-1 truncate text-[13.5px]">{{ accountDisplayLabel(a, allSiteTags.get(a.uid)) }}</span>
                <span class="mono max-w-[130px] truncate text-[12px] text-muted-foreground" :title="a.baseUrl">{{ allSiteTags.get(a.uid) }}</span>
              </div>
            </div>
          </Transition>
        </div>

        <Transition :css="false" @enter="onSectionEnter" @leave="onSectionLeave">
          <div v-if="singleAccount" class="grid gap-1.5">
            <Label>课程范围</Label>
            <div class="flex gap-1 rounded-lg bg-muted p-1">
              <button
                :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', courseMode === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
                @click="courseMode = 'all'"
              >全部课程</button>
              <button
                :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', courseMode === 'pick' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
                @click="courseMode = 'pick'"
              >指定课程</button>
            </div>
            <Transition :css="false" @enter="onPickerEnter" @leave="onPickerLeave">
              <div v-if="courseMode === 'pick'" class="grid gap-1.5">
                <div class="max-h-40 overflow-y-auto rounded-lg border border-border p-1.5">
                  <div v-if="coursesQuery.isLoading.value" class="space-y-1.5 p-1">
                    <Skeleton v-for="i in 3" :key="i" class="h-5 w-full" />
                  </div>
                  <p v-else-if="coursesQuery.error.value" class="p-2 text-[13.5px] text-muted-foreground">
                    课程列表拉取失败（账号可能离线，先到账号详情检测登录）
                  </p>
                  <p v-else-if="!(coursesQuery.data.value ?? []).length" class="p-2 text-[13.5px] text-muted-foreground">
                    该账号下暂无课程（可先到详情里检测登录）
                  </p>
                  <div
                    v-for="course in coursesQuery.data.value ?? []"
                    :key="course.id"
                    class="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40"
                  >
                    <Checkbox :model-value="picked.includes(course.id)" @update:model-value="toggleCourse(course.id)" />
                    <span class="min-w-0 flex-1 truncate text-[14px]">{{ course.name }}</span>
                    <span class="mono text-[12px] text-muted-foreground">{{ Math.round(course.progress) }}%</span>
                  </div>
                </div>
                <p class="text-[12px] text-muted-foreground">
                  到点只刷勾选的课程；平台重建课程后需回来重新勾选
                </p>
              </div>
            </Transition>
          </div>
        </Transition>
      </div>

      <!-- 右列：什么时候 + 怎么刷 -->
      <div class="grid content-start gap-3">
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium tracking-wide text-muted-foreground">什么时候</span>
          <span class="h-px flex-1 bg-border" />
        </div>

        <div class="grid gap-1.5">
          <Label>重复</Label>
          <div class="flex gap-1.5">
            <button
              v-for="d in WEEK"
              :key="d.value"
              :class="cn(
                'size-7 rounded-md border text-[13.5px] transition-colors',
                days.includes(d.value)
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )"
              @click="toggleDay(d.value)"
            >{{ d.label }}</button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5">
            <Label>开始时间</Label>
            <Input v-model="startTime" type="time" />
          </div>
          <div class="grid gap-1.5">
            <Label>结束时间（留空则不停止）</Label>
            <Input v-model="endTime" type="time" />
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label>到点停止行为</Label>
          <div class="flex gap-1 rounded-lg bg-muted p-1">
            <button
              :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', stopMode === 'finish_current' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
              @click="stopMode = 'finish_current'"
            >看完当前节点再停</button>
            <button
              :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', stopMode === 'immediate' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
              @click="stopMode = 'immediate'"
            >立即停止</button>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <span class="text-[12px] font-medium tracking-wide text-muted-foreground">怎么刷</span>
          <span class="h-px flex-1 bg-border" />
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div class="grid gap-1.5">
            <Label>模式</Label>
            <Select
              v-model="videoModeModel"
              :options="[{ value: '1', label: '普通' }, { value: '2', label: '暴力+去红' }, { value: '3', label: '仅去红' }]"
            />
          </div>
          <div class="grid gap-1.5">
            <Label>答题</Label>
            <Select
              v-model="answerSource"
              :options="[{ value: 'off', label: '不答题' }, { value: 'ai', label: 'AI' }, { value: 'bank', label: '题库' }]"
            />
          </div>
          <div class="grid gap-1.5">
            <Label>交卷</Label>
            <Select
              v-model="submitMode"
              :options="[{ value: 'off', label: '不交卷' }, { value: 'smart', label: '智能' }, { value: 'direct', label: '直接' }]"
            />
          </div>
        </div>

        <button
          class="justify-self-start text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          @click="showModeHelp = !showModeHelp"
        >{{ showModeHelp ? "收起模式说明" : "模式说明" }}</button>
        <Transition :css="false" @enter="onPickerEnter" @leave="onPickerLeave">
          <p v-if="showModeHelp" class="text-[12.5px] leading-relaxed text-muted-foreground">
            普通 = 课内视频逐个刷；暴力+去红 = 课内并发刷完后自动清理标红节点；仅去红 = 只做补救不刷课。
            作业/考试随节点触发；同一账号同时刷几门课由“设置 → 单账号课程并发数”统一控制。
          </p>
        </Transition>
      </div>
    </DialogBody>

    <DialogFooter class="items-center gap-3 sm:justify-between">
      <div class="grid gap-0.5 text-left">
        <span class="text-[13px] text-foreground/80">{{ preview }}</span>
        <code class="mono text-[11.5px] text-muted-foreground">{{ cron }}</code>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button :disabled="mutation.isPending.value" @click="submit">
          {{ mutation.isPending.value ? (isEdit ? "保存中…" : "创建中…") : isEdit ? "保存修改" : "创建规则" }}
        </Button>
      </div>
    </DialogFooter>
  </Dialog>
</template>
