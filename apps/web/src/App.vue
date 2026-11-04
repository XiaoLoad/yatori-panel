<script setup lang="ts">
import { Toaster } from "vue-sonner";
import ConfirmDialog from "@/components/ui/confirm/ConfirmDialog.vue";
import LoadingBar from "@/components/layout/LoadingBar.vue";
</script>

<template>
  <LoadingBar />
  <RouterView />
  <ConfirmDialog />
  <Toaster position="top-center" :duration="4000" />
</template>
