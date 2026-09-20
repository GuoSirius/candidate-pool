<script lang="ts">
// 图标名联合类型在这里定义（唯一来源），nav.ts 只引用类型、不重复维护字符串。
export const ICON_NAMES = [
  'list', 'grid', 'chart', 'clock', 'history', 'target', 'tag', 'book', 'menu', 'more',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
</script>

<script setup lang="ts">
// 极简线性图标：统一 16×16 视框、stroke 取 currentColor，
// 跟随文字颜色（含 active 高亮），零图标库依赖、可随主题变化。
defineProps<{ name: IconName }>();
</script>

<template>
  <svg
    class="nav-icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <g v-if="name === 'list'"><path d="M3 4.5h10M3 8h10M3 11.5h6" /></g>
    <g v-else-if="name === 'grid'">
      <path d="M3 3h4.4v4.4H3zM8.6 3H13v4.4H8.6zM3 8.6h4.4V13H3zM8.6 8.6H13V13H8.6z" />
    </g>
    <g v-else-if="name === 'chart'"><path d="M3.5 13V9M6.5 13V5M9.5 13V7.5M12.5 13V3.5" /></g>
    <g v-else-if="name === 'clock'">
      <circle cx="8" cy="8" r="5" /><path d="M8 5.2v3.1l2.1 1.3" />
    </g>
    <g v-else-if="name === 'history'">
      <path d="M3.2 6.6A5 5 0 118 13" /><path d="M3.2 3.6v3h3" /><path d="M8 5.6V8l2 1.2" />
    </g>
    <g v-else-if="name === 'target'">
      <circle cx="8" cy="8" r="4.6" /><circle cx="8" cy="8" r="1.5" />
      <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8" />
    </g>
    <g v-else-if="name === 'tag'">
      <path d="M3.4 3.4h4.3l4.9 4.9-4.3 4.3-4.9-4.9z" /><circle cx="6.1" cy="6.1" r="1" />
    </g>
    <g v-else-if="name === 'book'">
      <path d="M4.4 3.4h7.2v9.2H4.4zM4.4 6.4h7.2M4.4 9.4h7.2" />
    </g>
    <g v-else-if="name === 'menu'"><path d="M3 4h10M3 8h10M3 12h10" /></g>
    <g v-else-if="name === 'more'">
      <circle cx="3.8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12.2" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </g>
  </svg>
</template>

<style scoped>
.nav-icon { flex: none; display: block; }
</style>
