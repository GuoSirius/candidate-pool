<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <header class="topbar">
    <RouterLink class="brand" to="/">次日候选池</RouterLink>
    <nav>
      <RouterLink to="/">候选列表</RouterLink>
      <RouterLink to="/stocks">全部标的</RouterLink>
      <RouterLink to="/stats">复盘统计</RouterLink>
      <RouterLink to="/rules">规则释义</RouterLink>
    </nav>
  </header>
  <main>
    <RouterView />
  </main>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 18px;
}
.brand {
  font-weight: 700;
  font-size: 16px;
  color: var(--text);
  text-decoration: none;
}
nav { display: flex; gap: 16px; font-size: 14px; }
nav a { color: var(--muted); text-decoration: none; }
nav a.router-link-active { color: var(--accent); }
</style>
