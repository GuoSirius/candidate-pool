<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import type { RunBatch, PickRecord, Tier } from '../api/types';
import { TIER_ORDER, TIER_LABELS } from '../api/types';
import { fmtNum, fmtPct, fmtCap } from '../utils/format';
import { openStock } from '../utils/nav';
import TierBadge from '../components/TierBadge.vue';
import RuleTags from '../components/RuleTags.vue';

const router = useRouter();
const route = useRoute();

const runs = ref<RunBatch[]>([]);
const selectedAnchor = ref<string>('');
const run = ref<RunBatch | null>(null);
const picks = ref<PickRecord[]>([]);
const tierFilter = ref<'all' | Tier>('all');
const search = ref('');
const PAGE_SIZE = 50;
const page = ref(1);
const loading = ref(false);
const error = ref<string>('');

type TierFilter = 'all' | Tier;
const tierFilters: TierFilter[] = ['all', ...TIER_ORDER];

// —— 列表状态保持：进个股详情再返回时，恢复锚定日 / 档位 / 搜索 / 页码 / 滚动位置 ——
const STATE_KEY = 'cp:runs:state';
interface RunsState {
  anchor?: string;
  tier?: 'all' | Tier;
  search?: string;
  page?: number;
  scrollY?: number;
}
function readState(): RunsState {
  try {
    return JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}') as RunsState;
  } catch {
    return {};
  }
}
function writeState() {
  try {
    const s: RunsState = {
      anchor: selectedAnchor.value,
      tier: tierFilter.value,
      search: search.value,
      page: page.value,
      scrollY: window.scrollY,
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等写入失败时忽略 */
  }
}
// 恢复状态期间，切换锚定日不重置搜索/页码
let restoring = false;

const tierCounts = computed(() => {
  const c: Record<Tier, number> = { high: 0, secondary: 0, conditional: 0, excluded: 0 };
  for (const p of picks.value) c[p.tier] += 1;
  return c;
});

const filteredPicks = computed(() => {
  if (tierFilter.value === 'all') return picks.value;
  return picks.value.filter((p) => p.tier === tierFilter.value);
});

// 关键词筛选（代码 / 名称 / 板块），应对数据量增长后的快速定位
const searchedPicks = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return filteredPicks.value;
  return filteredPicks.value.filter((p) =>
    `${p.code} ${(p.name ?? '')} ${(p.sector ?? '')}`.toLowerCase().includes(q),
  );
});

const totalPages = computed(() => Math.max(1, Math.ceil(searchedPicks.value.length / PAGE_SIZE)));
const pagedPicks = computed(() => {
  const s = (page.value - 1) * PAGE_SIZE;
  return searchedPicks.value.slice(s, s + PAGE_SIZE);
});

async function loadRuns() {
  error.value = '';
  try {
    runs.value = await api.listRuns(30);
    if (runs.value.length && !selectedAnchor.value) {
      selectedAnchor.value = runs.value[0].anchor_date;
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  }
}

async function loadRun(anchor: string) {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.getRun(anchor);
    run.value = res.run;
    picks.value = res.picks;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    picks.value = [];
  } finally {
    loading.value = false;
    await applyPendingScroll();
  }
}

// 滚动位置恢复：真因是「原实现在该批次数据渲染出来之前就 scrollTo」——
// 此时表格还是空的、文档高度不足，浏览器会把位置截断到当前最大可滚范围。
// 因此把它挂起到 loadRun 拿到数据后，等 DOM 更新完再滚一次即可。
let pendingScrollY: number | null = null;
async function applyPendingScroll() {
  if (pendingScrollY === null) return;
  const y = pendingScrollY;
  pendingScrollY = null;
  await nextTick();
  window.scrollTo(0, y);
}

/** 该批次的入选数量（重点 + 次级 + 条件） */
function pickCount(r: RunBatch): number {
  return (r.high_count ?? 0) + (r.secondary_count ?? 0) + (r.conditional_count ?? 0);
}

function open(code: string) {
  openStock(router, route, code);
}

// 切换锚定日时回到第一页并清空搜索（恢复状态期间不重置）
watch(selectedAnchor, (a) => {
  if (!a) return;
  if (!restoring) {
    page.value = 1;
    search.value = '';
  }
  loadRun(a);
});
watch([tierFilter, search], () => {
  // 恢复状态期间不要重置页码，否则 saved.page 会被立刻覆盖为 1
  if (!restoring) page.value = 1;
});
// 状态变化即落盘；离开列表时记录滚动位置
watch([selectedAnchor, tierFilter, search, page], writeState);

onMounted(async () => {
  const saved = readState();
  restoring = true;
  // 滚动位置先挂起，等该批次数据渲染完（loadRun 的 finally）再恢复，否则页面高度不足会被截断
  pendingScrollY = saved.scrollY && saved.scrollY > 0 ? saved.scrollY : null;
  try {
    if (saved.tier) tierFilter.value = saved.tier;
    if (saved.search) search.value = saved.search;
    if (saved.page && saved.page > 0) page.value = saved.page;
    if (saved.anchor) selectedAnchor.value = saved.anchor; // 先占位，loadRuns 不再覆盖为最新
    await loadRuns();
    if (saved.anchor && !runs.value.some((r) => r.anchor_date === saved.anchor)) {
      selectedAnchor.value = runs.value[0]?.anchor_date ?? ''; // 已失效则回退最新
    }
  } finally {
    restoring = false;
  }
});

onBeforeUnmount(writeState);
</script>

<template>
  <div class="runs">
    <header class="page-head">
      <div>
        <h1>次日候选池</h1>
        <p class="sub">按锚定日查看入选标的与档位分布</p>
      </div>
      <router-link class="ghost-btn" to="/rules">规则释义 →</router-link>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- 锚定日选择（下拉：日期 + 入选数量） -->
    <section class="anchors" v-if="runs.length">
      <label class="anchor-select">
        <span class="lbl">锚定日</span>
        <select v-model="selectedAnchor">
          <option v-for="r in runs" :key="r.anchor_date" :value="r.anchor_date">
            {{ r.anchor_date }} · {{ pickCount(r) }} 只
          </option>
        </select>
        <span class="meta">共 {{ runs.length }} 个批次</span>
      </label>
    </section>

    <p v-else-if="!error" class="hint">加载运行批次中…</p>

    <!-- 运行概览 -->
    <section class="summary" v-if="run">
      <div class="card"><span class="k">锚定日</span><span class="v">{{ run.anchor_date }}</span></div>
      <div class="card"><span class="k">全市场样本</span><span class="v">{{ fmtNum(run.universe_count, 0) }}</span></div>
      <div class="card hi"><span class="k">重点</span><span class="v">{{ fmtNum(run.high_count, 0) }}</span></div>
      <div class="card se"><span class="k">次级</span><span class="v">{{ fmtNum(run.secondary_count, 0) }}</span></div>
      <div class="card co"><span class="k">条件</span><span class="v">{{ fmtNum(run.conditional_count, 0) }}</span></div>
      <div class="card ex"><span class="k">排除</span><span class="v">{{ fmtNum(run.excluded_count, 0) }}</span></div>
      <div class="card"><span class="k">R01/R07/R05</span><span class="v">{{ fmtNum(run.r01_count,0) }}/{{ fmtNum(run.r07_count,0) }}/{{ fmtNum(run.r05_count,0) }}</span></div>
      <div class="card" v-if="run.kline_fail_rate !== null"><span class="k">K线失败率</span><span class="v" :class="{ bad: (run.kline_fail_rate ?? 0) > 5 }">{{ fmtPct(run.kline_fail_rate, 1) }}</span></div>
    </section>

    <!-- 档位过滤 + 关键词搜索 -->
    <section class="filters" v-if="picks.length">
      <button
        v-for="t in tierFilters"
        :key="t"
        class="filter-btn"
        :class="{ active: tierFilter === t }"
        @click="tierFilter = t"
      >
        {{ t === 'all' ? '全部' : TIER_LABELS[t as Tier] }}
        <span class="cnt" v-if="t !== 'all'">{{ tierCounts[t as Tier] }}</span>
        <span class="cnt" v-else>{{ picks.length }}</span>
      </button>
      <input
        class="search-input"
        type="search"
        v-model="search"
        placeholder="搜索代码 / 名称 / 板块"
        aria-label="搜索入选标的"
      />
    </section>

    <!-- 口径速览（完整说明见「规则释义」页） -->
    <p class="legend" v-if="picks.length">
      <b>档位</b> = R01 梯队：重点（C1–C4 全达标）/ 次级（核心项 ≥3）/ 条件（核心项 ≥2）/ 排除（未达 R01 梯队，但命中 R07 或 R05 仍会入选）。
      <b>规则</b>列的 R01 / R07 / R05 为三条规则的命中标记（可叠加，R07、R05 与档位无关）。完整口径见
      <router-link to="/rules">规则释义</router-link>。
    </p>

    <!-- 入选列表 -->
    <section class="table-wrap" v-if="!loading && pagedPicks.length">
      <table class="grid">
        <!-- 列宽规划：文本列（代码/名称/板块/理由）较宽；标签列窄且居中；数值列右对齐 -->
        <colgroup>
          <col style="width: 7%" />
          <col style="width: 9%" />
          <col style="width: 5%" />
          <col style="width: 7%" />
          <col style="width: 9%" />
          <col style="width: 6%" />
          <col style="width: 6%" />
          <col style="width: 6%" />
          <col style="width: 5.5%" />
          <col style="width: 8.5%" />
          <col style="width: 6%" />
          <col style="width: 25%" />
        </colgroup>
        <thead>
          <tr>
            <th>代码</th><th>名称</th><th class="ctr">档位</th><th class="ctr">规则</th><th>板块</th>
            <th class="num">价格</th><th class="num">R01<br />涨跌</th><th class="num">换手率</th>
            <th class="num">量比</th>
            <th class="num">市值<br />流通 / 总</th>
            <th class="num">板块<br />强度</th><th>入选理由</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pagedPicks" :key="p.id" @click="open(p.code)">
            <td class="code" data-label="代码">{{ p.code }}</td>
            <td class="name" data-label="名称">{{ p.name ?? '—' }}</td>
            <td class="ctr" data-label="档位"><TierBadge :tier="p.tier" /></td>
            <td class="ctr" data-label="规则"><RuleTags :pick="p" /></td>
            <td class="sector" data-label="板块">{{ p.sector ?? '—' }}</td>
            <td class="num" data-label="价格">{{ fmtNum(p.price) }}</td>
            <td class="num" data-label="R01涨跌" :class="p.r01_chg !== null && p.r01_chg > 0 ? 'up' : p.r01_chg !== null && p.r01_chg < 0 ? 'down' : ''">{{ fmtPct(p.r01_chg) }}</td>
            <td class="num" data-label="换手率">{{ fmtPct(p.turnover) }}</td>
            <td class="num" data-label="量比">{{ fmtNum(p.vol_ratio) }}</td>
            <td class="num cap" data-label="市值(流通/总)">
              <span>{{ fmtCap(p.circ_market_cap) }}</span>
              <span class="sub">{{ fmtCap(p.total_market_cap) }}</span>
            </td>
            <td class="num" data-label="板块强度">{{ fmtPct(p.sector_pct) }}</td>
            <td class="reason" data-label="入选理由">{{ p.reason ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 分页 -->
    <div class="pager" v-if="!loading && totalPages > 1">
      <button class="pg-btn" :disabled="page <= 1" @click="page--">← 上一页</button>
      <span class="pg-info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ searchedPicks.length }} 只</span>
      <button class="pg-btn" :disabled="page >= totalPages" @click="page++">下一页 →</button>
    </div>

    <p v-else-if="loading" class="hint">加载入选列表…</p>
    <p v-else-if="!error && run && search.trim() && searchedPicks.length === 0" class="hint">无匹配「{{ search }}」的标的。</p>
    <p v-else-if="!error && run" class="hint">该锚定日暂无入选记录。</p>
  </div>
</template>

<style scoped>
.runs { display: flex; flex-direction: column; gap: 16px; }
.page-head { display: flex; align-items: center; justify-content: space-between; }
.page-head h1 { font-size: 22px; margin: 0; }
.sub { color: var(--muted); margin: 4px 0 0; font-size: 13px; }
.ghost-btn { color: var(--accent); text-decoration: none; font-size: 14px; }
.ghost-btn:hover { text-decoration: underline; }

.anchors { display: flex; align-items: center; }
.anchor-select { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
.anchor-select .lbl { font-weight: 600; color: var(--text); }
.anchor-select select {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 10px; padding: 7px 12px; font: inherit; font-size: 13px; min-width: 190px;
  cursor: pointer;
}
.anchor-select select:focus { outline: none; border-color: var(--accent); }
.anchor-select .meta { font-size: 12px; }

.summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.card .k { font-size: 12px; color: var(--muted); }
.card .v { font-size: 18px; font-weight: 700; }
.card.hi .v { color: #ff7b72; }
.card.se .v { color: #e3b341; }
.card.co .v { color: #79c0ff; }
.card.ex .v { color: #8b949e; }
.card .v.bad { color: #ff7b72; }

.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.filter-btn {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 999px; padding: 6px 14px; cursor: pointer; font: inherit; font-size: 13px;
}
.filter-btn.active { border-color: var(--accent); background: rgba(31,111,235,0.12); color: var(--accent); }
.filter-btn .cnt { margin-left: 6px; font-size: 11px; color: var(--muted); }
.search-input {
  margin-left: auto; min-width: 200px; flex: 0 1 260px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 13px;
}
.search-input:focus { outline: none; border-color: var(--accent); }

/* 表格：table-layout: fixed + 百分比列宽 → 表格宽度恒等于容器，任何窗口宽度都不产生横向滚动 */
.table-wrap { overflow: hidden; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 7px; text-align: left; overflow-wrap: anywhere; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; line-height: 1.3; }
.grid tbody tr { border-top: 1px solid var(--border); cursor: pointer; }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 12px; }
.grid th.ctr, .grid td.ctr { text-align: center; }
.grid .code { white-space: nowrap; font-weight: 600; color: var(--accent); }
.grid .name { font-weight: 500; }
.grid .sector, .grid .reason { color: var(--muted); }
.grid .reason { white-space: normal; line-height: 1.5; }
/* 市值列：流通 / 总 两行展示，省下一列宽度 */
.grid td.cap { line-height: 1.35; }
.grid td.cap .sub { display: block; color: var(--muted); font-size: 11px; }
/* 规则标签在本表内压缩，避免 3 个标签把「规则」列撑宽 */
.grid :deep(.rule-tags) { gap: 2px; }
.grid :deep(.rule-tag) { padding: 0 4px; font-size: 10px; }
.up { color: #ff7b72; }
.down { color: #3fb950; }

.pager { display: flex; align-items: center; justify-content: center; gap: 14px; }
.pg-btn {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 6px 14px; cursor: pointer; font: inherit; font-size: 13px;
}
.pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pg-info { font-size: 13px; color: var(--muted); }

.legend { color: var(--muted); font-size: 12px; line-height: 1.75; margin: 0; }
.legend a { color: var(--accent); text-decoration: none; }
.legend a:hover { text-decoration: underline; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }

/* 窄屏（≤820px）：表格翻转成卡片，彻底消除横向滚动 */
@media (max-width: 820px) {
  .table-wrap { border: none; border-radius: 0; }
  .grid, .grid tbody, .grid tr, .grid td { display: block; width: 100%; }
  .grid thead { display: none; }
  .grid tr {
    border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px;
    padding: 8px 4px; background: var(--surface);
  }
  .grid tbody tr:hover { background: var(--surface); }
  .grid td {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
    padding: 6px 12px; border: none; text-align: left; white-space: normal;
  }
  .grid td::before {
    content: attr(data-label); color: var(--muted); font-size: 12px; font-weight: 600;
    flex: 0 0 auto; margin-right: 8px;
  }
  .grid td.num { text-align: left; }
  .grid td.ctr { text-align: left; }
  .grid td.code, .grid td.num, .grid td.mono { white-space: nowrap; }
  .grid td.sector, .grid td.reason { white-space: normal; max-width: none; color: var(--muted); }
  .grid th:first-child, .grid td:first-child { position: static; background: transparent; }
  .search-input { margin-left: 0; flex-basis: 100%; }
}
</style>
