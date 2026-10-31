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
      <main class="flex-1 p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
