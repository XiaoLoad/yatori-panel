<script setup lang="ts">
import { ConfigProvider } from "reka-ui";
import { Toaster } from "vue-sonner";
import ConfirmDialog from "@/components/ui/confirm/ConfirmDialog.vue";
import LoadingBar from "@/components/layout/LoadingBar.vue";
</script>

<template>
  <!--
    全局关闭 body 滚动锁的 padding 补偿：页面已用 scrollbar-gutter 常驻滚动条槽位，
    若再叠加 padding-right 会产生二次偏移。关闭后弹窗/下拉不会改变内容宽度。
  -->
  <ConfigProvider :scroll-body="false">
    <LoadingBar />
    <RouterView />
    <ConfirmDialog />
    <Toaster position="top-center" :duration="4000" />
  </ConfigProvider>
</template>
