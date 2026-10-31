<script setup lang="ts">
import { BookOpen } from "lucide-vue-next";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { api } from "@/api/resources";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  <div class="flex min-h-screen items-center justify-center bg-muted/40 p-6">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center">
        <div class="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpen class="size-5" />
        </div>
        <CardTitle>Yatori 面板</CardTitle>
        <CardDescription>输入访问密码解锁面板</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          class="grid gap-4"
          @submit.prevent="submit"
        >
          <div class="grid gap-2">
            <Label for="password">访问密码</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <Button type="submit" :disabled="pending">
            {{ pending ? "验证中…" : "解锁" }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
