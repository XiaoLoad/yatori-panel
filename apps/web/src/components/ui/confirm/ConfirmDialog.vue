<script setup lang="ts">
import { AlertTriangle, Trash2 } from "lucide-vue-next";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmState, resolveConfirm } from "@/lib/confirm";
import { cn } from "@/lib/utils";

const danger = computed(() => confirmState.tone === "danger");
const icon = computed(() => (danger.value ? Trash2 : AlertTriangle));
</script>

<template>
  <Dialog
    class="max-w-[440px]"
    :open="confirmState.open"
    @update:open="(open) => { if (!open) resolveConfirm(false) }"
  >
    <DialogHeader class="border-b-0 pb-5">
      <div class="flex items-start gap-3">
        <span
          :class="cn(
            'mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border',
            danger
              ? 'border-coral/30 bg-coral/10 text-coral'
              : 'border-amber/30 bg-amber/10 text-amber',
          )"
        >
          <component :is="icon" class="size-4" />
        </span>
        <div class="grid min-w-0 flex-1 gap-1 pr-8">
          <DialogTitle>{{ confirmState.title }}</DialogTitle>
          <DialogDescription v-if="confirmState.description">
            {{ confirmState.description }}
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>

    <DialogFooter>
      <Button variant="outline" @click="resolveConfirm(false)">{{ confirmState.cancelText }}</Button>
      <Button
        :variant="danger ? 'destructive' : 'default'"
        @click="resolveConfirm(true)"
      >{{ confirmState.confirmText }}</Button>
    </DialogFooter>
  </Dialog>
</template>
