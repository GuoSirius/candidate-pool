<script setup lang="ts">
// 分组导航列表：桌面左栏与移动端「更多」抽屉共用同一份渲染，
// 保证两处的分组、顺序、待上线标记永远一致（不各写一套）。
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { NAV_GROUPS, isNavActive, type NavItem } from '../constants/nav';
import NavIcon from './NavIcon.vue';

const emit = defineEmits<{ navigate: [] }>();
const route = useRoute();

// 详情页靠 ?from= 回推归属，见 constants/nav.ts 的 isNavActive 注释
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : ''));

function isActive(it: NavItem): boolean {
  return isNavActive(it, route.path, from.value);
}
</script>

<template>
  <nav class="nav-list">
    <div v-for="g in NAV_GROUPS" :key="g.key" class="nav-group">
      <p class="nav-group-label">{{ g.label }}</p>
      <template v-for="it in g.items" :key="it.key">
        <span v-if="it.soon" class="nav-item is-soon" :title="`${it.label}（尚未上线）`">
          <NavIcon :name="it.icon" />
          <span class="nav-item-text">{{ it.label }}</span>
          <span class="soon-tag">待上线</span>
        </span>
        <RouterLink
          v-else
          class="nav-item"
          :class="{ active: isActive(it) }"
          :to="it.to"
          @click="emit('navigate')"
        >
          <NavIcon :name="it.icon" />
          <span class="nav-item-text">{{ it.label }}</span>
        </RouterLink>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.nav-list { display: flex; flex-direction: column; gap: 18px; }

.nav-group-label {
  margin: 0 0 6px;
  padding: 0 10px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--muted);
}

/* 左侧 2px 竖条做选中态：不改变行宽、不引发重排，且在深色底上足够明显 */
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13.5px;
  color: var(--muted);
  text-decoration: none;
  cursor: pointer;
}
.nav-item + .nav-item { margin-top: 2px; }
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.active { background: var(--surface-2); color: var(--accent); }
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 16px;
  border-radius: 2px;
  background: var(--accent);
}
.nav-item-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 待上线：占位但不误导 —— 不可点击 + 明确标记 */
.nav-item.is-soon { color: #6b7280; cursor: default; }
.nav-item.is-soon:hover { background: none; color: #6b7280; }
.soon-tag {
  flex: none;
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--muted);
}
</style>
