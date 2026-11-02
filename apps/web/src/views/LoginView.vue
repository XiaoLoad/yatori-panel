<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { api } from "@/api/resources";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const router = useRouter();
const auth = useAuthStore();
const password = ref("");
const pending = ref(false);

async function submit() {
  if (!password.value) return;
  pending.value = true;
  try {
    await api.login(password.value);
    await auth.refresh();
    router.push("/");
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="relative grid min-h-screen place-items-center px-6">
    <div class="pointer-events-none absolute inset-0 opacity-70">
      <div class="absolute left-1/2 top-0 h-full w-px bg-border" />
      <div class="absolute left-0 top-1/2 h-px w-full bg-border" />
    </div>

    <div class="relative w-full max-w-[380px]">
      <div class="mb-7 text-center">
        <div class="eyebrow">Yatori / Access Control</div>
        <h1 class="display-title mt-2 text-[32px] leading-none">观测台</h1>
        <p class="mt-3 text-[13.5px] text-muted-foreground">多账号课程助手 · 访问验证</p>
      </div>

      <div class="panel p-6">
        <div class="flex items-center gap-2">
          <span class="size-1.5 animate-breathe rounded-full bg-primary" />
          <span class="mono text-[11.5px] uppercase tracking-widest text-muted-foreground">Awaiting credential</span>
        </div>
        <form class="mt-5 grid gap-4" @submit.prevent="submit">
          <div class="grid gap-1.5">
            <Label class="text-[13.5px]">访问密码</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              placeholder="至少 6 位"
              class="h-10"
            />
          </div>
          <Button type="submit" class="h-10" :disabled="pending">
            {{ pending ? "验证中…" : "解锁面板" }}
          </Button>
        </form>
        <div class="hair mt-5" />
        <p class="mono mt-3 text-center text-[11px] leading-4 text-muted-foreground">
          凭据加密存储于本机 · 不经过任何第三方服务
        </p>
      </div>
    </div>
  </div>
</template>
