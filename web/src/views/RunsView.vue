<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/client';
import type { RunBatch, PickRecord, Tier } from '../api/types';
import { TIER_ORDER, TIER_LABELS } from '../api/types';
import { fmtNum, fmtPct, fmtCap } from '../utils/format';
import TierBadge from '../components/TierBadge.vue';
import RuleTags from '../components/RuleTags.vue';

const router = useRouter();

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
  }
}

function selectAnchor(anchor: string) {
  selectedAnchor.value = anchor;
}

function openStock(code: string) {
  router.push(`/stock/${code}`);
}

// 切换锚定日 / 档位 / 关键词时回到第一页
watch(selectedAnchor, (a) => {
  if (a) {
    page.value = 1;
    search.value = '';
    loadRun(a);
  }
});
watch([tierFilter, search], () => {
  page.value = 1;
});

onMounted(loadRuns);
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

    <!-- 锚定日选择 -->
    <section class="anchors" v-if="runs.length">
      <div class="anchor-scroll">
        <button
          v-for="r in runs"
          :key="r.anchor_date"
          class="anchor-chip"
          :class="{ active: r.anchor_date === selectedAnchor }"
          @click="selectAnchor(r.anchor_date)"
        >
          <span class="d">{{ r.anchor_date }}</span>
          <span class="c">{{ (r.high_count ?? 0) + (r.secondary_count ?? 0) + (r.conditional_count ?? 0) }} 只</span>
        </button>
      </div>
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

    <!-- 入选列表 -->
    <section class="table-wrap" v-if="!loading && pagedPicks.length">
      <table class="grid">
        <thead>
          <tr>
            <th>代码</th><th>名称</th><th>档位</th><th>规则</th><th>板块</th>
            <th class="num">价格</th><th class="num">R01涨跌</th><th class="num">换手率</th>
            <th class="num">流通市值</th><th class="num">板块强度</th><th>入选理由</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pagedPicks" :key="p.id" @click="openStock(p.code)">
            <td class="code" data-label="代码">{{ p.code }}</td>
            <td class="name" data-label="名称">{{ p.name ?? '—' }}</td>
            <td data-label="档位"><TierBadge :tier="p.tier" /></td>
            <td data-label="规则"><RuleTags :pick="p" /></td>
            <td class="sector" data-label="板块">{{ p.sector ?? '—' }}</td>
            <td class="num" data-label="价格">{{ fmtNum(p.price) }}</td>
            <td class="num" data-label="R01涨跌" :class="p.r01_chg !== null && p.r01_chg > 0 ? 'up' : p.r01_chg !== null && p.r01_chg < 0 ? 'down' : ''">{{ fmtPct(p.r01_chg) }}</td>
            <td class="num" data-label="换手率">{{ fmtPct(p.turnover) }}</td>
            <td class="num" data-label="流通市值">{{ fmtCap(p.circ_market_cap) }}</td>
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

.anchors { overflow: hidden; }
.anchor-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; }
.anchor-chip {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 10px; padding: 8px 12px; cursor: pointer; white-space: nowrap;
  font: inherit;
}
.anchor-chip.active { border-color: var(--accent); background: rgba(31,111,235,0.12); }
.anchor-chip .d { font-weight: 600; font-size: 13px; }
.anchor-chip .c { font-size: 11px; color: var(--muted); }

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

/* 表格：桌面端自适应宽度，文本列允许换行 → 不再强制横向滚动 */
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.grid th, .grid td { padding: 9px 12px; text-align: left; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; position: sticky; top: 0; z-index: 2; }
.grid tbody tr { border-top: 1px solid var(--border); cursor: pointer; }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .code, .grid .num, .grid .mono { white-space: nowrap; }
.grid .name, .grid .sector { white-space: nowrap; }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; }
/* 首列（代码）吸顶吸左，作为横向滚动时的定位锚点 */
.grid th:first-child, .grid td:first-child { position: sticky; left: 0; z-index: 1; background: var(--bg); }
.grid thead th:first-child { z-index: 3; background: var(--surface); }
.grid .code { font-weight: 600; color: var(--accent); }
.grid .name { font-weight: 500; }
.grid .sector, .grid .reason { color: var(--muted); }
.grid .reason { white-space: normal; }
.up { color: #ff7b72; }
.down { color: #3fb950; }

.pager { display: flex; align-items: center; justify-content: center; gap: 14px; }
.pg-btn {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 6px 14px; cursor: pointer; font: inherit; font-size: 13px;
}
.pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pg-info { font-size: 13px; color: var(--muted); }

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
  .grid td.code, .grid td.num, .grid td.mono { white-space: nowrap; }
  .grid td.sector, .grid td.reason { white-space: normal; max-width: none; color: var(--muted); }
  .grid th:first-child, .grid td:first-child { position: static; background: transparent; }
  .search-input { margin-left: 0; flex-basis: 100%; }
}
</style>
