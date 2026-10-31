<script setup lang="ts">
import { RouterView } from "vue-router";
import SidebarNav from "./SidebarNav.vue";
import HeaderBar from "./HeaderBar.vue";
</script>

<template>
  <div class="flex min-h-screen">
    <SidebarNav />
    <div class="flex min-w-0 flex-1 flex-col">
      <HeaderBar />
      <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
