<script setup lang="ts">
/*
 * 应用外壳（App Shell）
 * ---------------------------------------------------------------------------
 * 一个 Shell，三套呈现，共用 constants/nav.ts 一份导航数据：
 *   - 桌面 ≥900px：左侧栏（分组导航，可滚动），底部固定「写权限」
 *   - 手机 <900px：顶部 App Bar（菜单按钮 + 当前页名 + 写权限）+ 固定底部标签栏
 *   - 手机「更多」：抽屉里放完整分组菜单
 *
 * 之所以这么做：原先顶栏是唯一导航且全站没有任何 @media，加到第 6 个入口就会
 * 在手机上折行、在桌面上变得难以检索。抽成 Shell 后：
 *   1. 新增页面只改 nav.ts，桌面/底栏/抽屉三处自动同步；
 *   2. 桌面用左栏把「分组」这一层信息表达出来（盘后 / 盘中 / 我的 / 参考）；
 *   3. 手机有底栏兜住一级入口，长列表页滚动时导航不再消失（原顶栏会随页面滚走）。
 * ---------------------------------------------------------------------------
 */
import { computed, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { TABBAR_ITEMS, findNavItem, isNavActive, type NavItem } from '../constants/nav';
import NavIcon from './NavIcon.vue';
import NavList from './NavList.vue';
import WriteTokenBar from './WriteTokenBar.vue';

const route = useRoute();
const drawerOpen = ref(false);

const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : ''));

function isActive(it: NavItem): boolean {
  return isNavActive(it, route.path, from.value);
}

/** 手机 App Bar 的标题：导航项名 → 详情页专用名 → 兜底 */
const currentTitle = computed(() => {
  const hit = findNavItem(route.path);
  if (hit) return hit.label;
  if (route.path.startsWith('/stock/')) return '个股详情';
  return '次日候选池';
});

// 跳转后自动收起抽屉：否则点完菜单抽屉还挡在内容上
watch(() => route.fullPath, () => { drawerOpen.value = false; });
</script>

<template>
  <div class="shell">
    <!-- 桌面左栏 -->
    <aside class="sidebar">
      <RouterLink class="brand" to="/">
        <span class="brand-name">次日候选池</span>
        <span class="brand-sub">A 股筛选与复盘</span>
      </RouterLink>
      <div class="side-scroll"><NavList /></div>
      <div class="side-foot"><WriteTokenBar placement="up" /></div>
    </aside>

    <!-- 手机顶部栏 -->
    <header class="appbar">
      <button class="icon-btn" type="button" aria-label="打开菜单" @click="drawerOpen = true">
        <NavIcon name="menu" />
      </button>
      <span class="appbar-title">{{ currentTitle }}</span>
      <WriteTokenBar placement="down" />
    </header>

    <main class="content"><RouterView /></main>

    <!-- 手机底部标签栏 -->
    <nav class="tabbar" aria-label="主导航">
      <RouterLink
        v-for="it in TABBAR_ITEMS"
        :key="it.key"
        class="tab"
        :class="{ active: isActive(it) }"
        :to="it.to"
      >
        <NavIcon :name="it.icon" />
        <span class="tab-text">{{ it.tabLabel || it.label }}</span>
      </RouterLink>
      <button class="tab" type="button" :class="{ active: drawerOpen }" @click="drawerOpen = true">
        <NavIcon name="more" />
        <span class="tab-text">更多</span>
      </button>
    </nav>

    <!-- 手机「更多」抽屉 -->
    <div v-if="drawerOpen" class="drawer-mask" @click="drawerOpen = false"></div>
    <aside class="drawer" :class="{ open: drawerOpen }" :aria-hidden="drawerOpen ? 'false' : 'true'">
      <div class="drawer-head">
        <span class="brand-name">次日候选池</span>
        <button class="icon-btn" type="button" aria-label="关闭菜单" @click="drawerOpen = false">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div class="drawer-body"><NavList @navigate="drawerOpen = false" /></div>
      <div class="drawer-foot"><WriteTokenBar placement="up" /></div>
    </aside>
  </div>
</template>

<style scoped>
/* ---- 桌面：左侧栏 + 内容 ---- */
/* 侧栏宽度集中一处（本组件自定义属性），供下方 grid 使用 */
.shell { min-height: 100vh; --sidebar-w: 216px; }

@media (min-width: 900px) {
  .shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    gap: 28px;
  }
  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 0;
    /* 注意：此处不能加 overflow，否则「写权限」浮层会被裁掉；
       需要滚动的只是中间的导航区。 */
  }
  /* 导航区单独滚动，页脚常驻可见 */
  .side-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-left: 8px; margin-left: -8px; }
  .side-foot { flex: none; padding-left: 10px; border-top: 1px solid var(--border); padding-top: 12px; }
  .appbar, .tabbar, .drawer, .drawer-mask { display: none; }
  .content { padding: 18px 0 56px; min-width: 0; }
}

/* ---- 手机 / 平板窄屏：顶部栏 + 底栏 ---- */
@media (max-width: 899px) {
  .sidebar { display: none; }

  .appbar {
    position: sticky;
    top: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 10px;
    /* 刘海屏 / 灵动岛：PWA standalone 下必须留出安全区，否则标题被遮 */
    padding: calc(8px + env(safe-area-inset-top, 0px)) 14px 8px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .appbar-title {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 底部标签栏常驻：长表格页滚动时导航不再消失 */
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 8px 2px 7px;
    background: none;
    border: none;
    font-family: inherit;
    font-size: 10.5px;
    line-height: 1;
    color: var(--muted);
    text-decoration: none;
    cursor: pointer;
  }
  .tab.active { color: var(--accent); }
  .tab-text { font-size: 10.5px; }

  /* 内容底部留出底栏高度，避免最后一行被遮 */
  .content {
    padding: 14px 14px calc(58px + env(safe-area-inset-bottom, 0px) + 20px);
    min-width: 0;
  }

  .drawer-mask {
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgba(0, 0, 0, 0.5);
  }
  .drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 60;
    width: min(300px, 86vw);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-right: 1px solid var(--border);
    transform: translateX(-100%);
    transition: transform 0.18s ease-out;
    padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px);
  }
  .drawer.open { transform: translateX(0); }
  .drawer-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 14px 12px;
    border-bottom: 1px solid var(--border);
  }
  .drawer-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 12px; }
  .drawer-foot { flex: none; padding: 12px 14px 14px; border-top: 1px solid var(--border); }
}

/* ---- 共用 ---- */
.brand { display: flex; flex-direction: column; gap: 2px; padding: 0 10px; text-decoration: none; }
.brand-name { font-size: 15px; font-weight: 600; color: var(--text); }
.brand-sub { font-size: 11px; color: var(--muted); }

.icon-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: none;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--muted);
  cursor: pointer;
}
.icon-btn:hover { color: var(--text); border-color: var(--border); background: var(--surface-2); }
</style>
