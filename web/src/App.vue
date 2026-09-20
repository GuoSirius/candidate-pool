<script setup lang="ts">
// 入口只负责挂载应用外壳；导航与布局职责全部下沉到 components/AppShell.vue
// （导航数据在 constants/nav.ts）。这样各视图不再关心顶栏长什么样。
import AppShell from './components/AppShell.vue';
</script>

<template>
  <AppShell />
</template>
