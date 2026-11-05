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
    const r = await api.login(password.value);
    await auth.refresh();
    // 系统生成的初始密码：登录后直接引导到设置页换自己的密码
    if (r?.mustChangePassword) {
      toast.info("当前为系统生成的初始密码，请立即设置你自己的访问密码");
      router.push("/settings");
    } else {
      router.push("/");
    }
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="relative grid min-h-screen place-items-center px-6">
    <div class="relative w-full max-w-[380px]">
      <div class="mb-7 text-center">
        <h1 class="display-title text-[26px] leading-none">Yatori 刷课控制台</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">多账号课程助手 · 请输入访问密码</p>
      </div>

      <div class="panel p-6">
        <div class="flex items-center gap-2">
          <span class="size-1.5 animate-breathe rounded-full bg-primary" />
          <span class="text-[12.5px] text-muted-foreground">面板已启用访问锁</span>
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
        <p class="mt-3 text-center text-[12px] leading-5 text-muted-foreground">
          凭据加密存储于本机 · 不经过任何第三方服务
        </p>
      </div>
    </div>
  </div>
</template>
