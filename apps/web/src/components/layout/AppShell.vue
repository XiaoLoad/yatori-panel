<script setup lang="ts">
import { RouterView } from "vue-router";
import TopBar from "./TopBar.vue";
import { useEventStream } from "@/composables/useEventStream";

useEventStream();
</script>

<template>
  <div class="relative min-h-screen">
    <TopBar />
    <main class="mx-auto w-full max-w-[1480px] px-4 pb-20 pt-6 md:px-8">
      <RouterView />
    </main>
  </div>
</template>
