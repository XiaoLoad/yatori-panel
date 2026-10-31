import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./assets/main.css";
import "vue-sonner/style.css";

createApp(App).use(createPinia()).use(router).use(VueQueryPlugin).mount("#app");
