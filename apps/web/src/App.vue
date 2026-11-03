<script setup lang="ts">
import { Toaster } from "vue-sonner";
import ConfirmDialog from "@/components/ui/confirm/ConfirmDialog.vue";
</script>

<template>
  <RouterView />
  <ConfirmDialog />
  <Toaster position="top-center" :duration="4000" />
</template>
