<script setup lang="ts">
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-input text-foreground",
        success: "bg-emerald-600 text-white",
        warning: "bg-amber-500 text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const props = defineProps<{
  variant?: VariantProps<typeof badgeVariants>["variant"];
  class?: string;
}>();
</script>

<template>
  <span :class="cn(badgeVariants({ variant: props.variant }), props.class)">
    <slot />
  </span>
</template>
