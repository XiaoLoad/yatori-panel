<script setup lang="ts">
import { AlertTriangle, Trash2 } from "lucide-vue-next";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmState, resolveConfirm } from "@/lib/confirm";
import { cn } from "@/lib/utils";

const danger = computed(() => confirmState.tone === "danger");
const icon = computed(() => (danger.value ? Trash2 : AlertTriangle));
const sideLabel = computed(() => (danger.value ? "危险操作" : "需要确认"));
const sideHint = computed(() => (danger.value ? "此操作无法撤销" : "请确认后继续"));
</script>

<template>
  <Dialog
    class="max-w-[560px]"
    :open="confirmState.open"
    @update:open="(open) => { if (!open) resolveConfirm(false) }"
  >
    <div class="grid grid-cols-1 sm:grid-cols-[128px_minmax(0,1fr)]">
      <div
        :class="cn(
          'flex flex-row items-center gap-3 border-b border-border bg-panel-2 px-4 py-3',
          'sm:flex-col sm:items-start sm:border-b-0 sm:border-r sm:px-5 sm:py-5',
        )"
      >
        <span
          :class="cn(
            'grid size-9 shrink-0 place-items-center rounded-lg border',
            danger
              ? 'border-coral/30 bg-coral/10 text-coral'
              : 'border-amber/30 bg-amber/10 text-amber',
          )"
        >
          <component :is="icon" class="size-[18px]" />
        </span>
        <div class="min-w-0">
          <div
            :class="cn(
              'text-[12px] font-medium',
              danger ? 'text-coral' : 'text-amber',
            )"
          >{{ sideLabel }}</div>
          <div class="mt-1 text-[12px] text-muted-foreground">{{ sideHint }}</div>
        </div>
      </div>

      <div class="min-w-0 px-5 py-4 pr-12">
        <DialogTitle class="text-[17px] leading-snug">{{ confirmState.title }}</DialogTitle>
        <DialogDescription
          v-if="confirmState.description"
          class="mt-1.5 text-[13.5px] leading-5"
        >{{ confirmState.description }}</DialogDescription>

        <div class="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" class="h-8 px-3 text-[13px]" @click="resolveConfirm(false)">
            {{ confirmState.cancelText }}
          </Button>
          <Button
            :variant="danger ? 'destructive' : 'default'"
            size="sm"
            class="h-8 px-3 text-[13px]"
            @click="resolveConfirm(true)"
          >{{ confirmState.confirmText }}</Button>
        </div>
      </div>
    </div>
  </Dialog>
</template>
