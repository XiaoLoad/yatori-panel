<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  type DialogRootProps,
  useForwardPropsEmits,
} from "reka-ui";
import { X } from "lucide-vue-next";
import { cn } from "@/lib/utils";

const props = defineProps<DialogRootProps & { class?: string }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();
const forwarded = useForwardPropsEmits(props, emit);
</script>

<template>
  <DialogRoot v-bind="forwarded">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out"
      />
      <DialogContent
        :class="cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl border border-border bg-card p-0 shadow-[0_0_80px_-20px_rgba(0,0,0,0.85)]',
          props.class,
        )"
      >
        <slot />
        <DialogClose
          class="absolute right-3.5 top-3.5 z-10 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X class="size-4" />
          <span class="sr-only">关闭</span>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
