<script setup lang="ts">
import { Toaster } from "vue-sonner";
</script>

<template>
  <RouterView />
  <Toaster position="top-center" :duration="4000" />
</template>
