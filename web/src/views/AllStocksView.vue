<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import { TIER_LABELS, TIER_ORDER } from '../api/types';
import type { StockRankRow, Tier } from '../api/types';
import { fmtPct, perfClass } from '../utils/format';
import { openStock } from '../utils/nav';

const router = useRouter();
const route = useRoute();

const rows = ref<StockRankRow[]>([]);
const loading = ref(false);
const error = ref<string>('');
const search = ref('');

/**
 * 档位筛选：'' = 全部；否则只看「在该档位至少入选过 1 次」的标的。
 * 用「有过该档记录」而不是「只保留该档」，是因为一只票可能同时有重点与条件记录，
 * 用前者才能把「曾进过重点」的票都捞出来。
 */
const tierFilter = ref<'' | Tier>('');

const TIER_OPTIONS: Array<{ value: '' | Tier; label: string }> = [
  { value: '', label: '全部档位' },
  ...TIER_ORDER.map((t) => ({ value: t as '' | Tier, label: TIER_LABELS[t] })),
];

type SortKey =
  | 'code'
  | 'name'
  | 'sector'
  | 'picks'
  | 'high'
  | 'secondary'
  | 'conditional'
  | 'excluded'
  | 'n1_avg'
  | 'n2_avg'
  | 'n3_avg'
  | 'last_anchor'
  | 'first_anchor';

const NUM_KEYS: SortKey[] = [
  'picks',
  'high',
  'secondary',
  'conditional',
  'excluded',
  'n1_avg',
  'n2_avg',
  'n3_avg',
];

interface Col {
  key: SortKey;
  label: string;
  num?: boolean;
  tip?: string;
}

const AVG_TIP = '该票每次入选后第 N 个交易日的涨跌幅，相对各自入选价，再取算术平均';

const COLS: Col[] = [
  { key: 'code', label: '代码' },
  { key: 'name', label: '名称' },
  { key: 'sector', label: '板块' },
  { key: 'picks', label: '入选<br />次数', num: true, tip: '该票在全部批次中的入选总次数' },
  { key: 'high', label: '重点', num: true },
  { key: 'secondary', label: '次级', num: true },
  { key: 'conditional', label: '条件', num: true },
  { key: 'excluded', label: '排除', num: true },
  { key: 'n1_avg', label: 'N1<br />平均', num: true, tip: AVG_TIP },
  { key: 'n2_avg', label: 'N2<br />平均', num: true, tip: AVG_TIP },
  { key: 'n3_avg', label: 'N3<br />平均', num: true, tip: AVG_TIP },
  { key: 'last_anchor', label: '最近入选', tip: '默认按此列倒序（最近入选的标的最前）' },
  { key: 'first_anchor', label: '首次入选' },
];

// 默认：按最近入选时间倒序
const sortKey = ref<SortKey>('last_anchor');
const sortDir = ref<'asc' | 'desc'>('desc');

// —— 列表状态保持：进个股详情再返回时，恢复搜索 / 档位 / 排序 / 滚动位置 ——
const STATE_KEY = 'cp:allstocks:state';
interface AllState {
  search?: string;
  tier?: '' | Tier;
  sortKey?: SortKey;
  sortDir?: 'asc' | 'desc';
  scrollY?: number;
}
function readState(): AllState {
  try {
    return JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}') as AllState;
  } catch {
    return {};
  }
}
function writeState() {
  try {
    const s: AllState = {
      search: search.value,
      tier: tierFilter.value,
      sortKey: sortKey.value,
      sortDir: sortDir.value,
      scrollY: window.scrollY,
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等写入失败时忽略 */
  }
}

function toggleSort(k: SortKey) {
  if (sortKey.value === k) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
    return;
  }
  sortKey.value = k;
  // 数量列先看「最多」，其余列先看「字典序 / 最早」
  sortDir.value = NUM_KEYS.includes(k) ? 'desc' : k.endsWith('_anchor') ? 'desc' : 'asc';
}

function cellValue(r: StockRankRow, k: SortKey): number | string {
  const v = (r as unknown as Record<string, number | string | null>)[k];
  return v === null || v === undefined ? '' : v;
}

/** 收益列悬浮说明：把口径与样本数讲清楚（三个周期的样本数可能不一样）。 */
function avgTitle(r: StockRankRow, h: 'n1' | 'n2' | 'n3'): string {
  if (h === 'n1') {
    return r.n1_avg === null
      ? 'N1 平均：暂无可用样本（入选后第 1 个交易日的数据还没出来）'
      : `N1 平均：${fmtPct(r.n1_avg)}｜样本 ${r.n1_n} 次入选（每次相对各自入选价）`;
  }
  if (h === 'n2') {
    return r.n2_avg === null
      ? 'N2 平均：暂无可用样本（入选后第 2 个交易日的数据还没出来）'
      : `N2 平均：${fmtPct(r.n2_avg)}｜样本 ${r.n2_n} 次入选（每次相对各自入选价）`;
  }
  return r.n3_avg === null
    ? 'N3 平均：暂无可用样本（入选后第 3 个交易日的数据还没出来）'
    : `N3 平均：${fmtPct(r.n3_avg)}｜样本 ${r.n3_n} 次入选（每次相对各自入选价）`;
}

const filtered = computed(() => {
  const t = tierFilter.value;
  const q = search.value.trim().toLowerCase();
  let list = rows.value;
  if (t) list = list.filter((r) => r[t] > 0);
  if (!q) return list;
  return list.filter((r) => `${r.code} ${r.name ?? ''} ${r.sector ?? ''}`.toLowerCase().includes(q));
});

/** 是否有生效中的筛选（决定是否显示「清除」与空态文案）。 */
const filterActive = computed(() => !!search.value.trim() || !!tierFilter.value);

function resetFilters(): void {
  search.value = '';
  tierFilter.value = '';
}

const sorted = computed(() => {
  const k = sortKey.value;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  const numeric = NUM_KEYS.includes(k);
  return [...filtered.value].sort((a, b) => {
    const av = cellValue(a, k);
    const bv = cellValue(b, k);
    // 空值（如收益列无样本）恒排最后，不随升降序翻转，也不会被当成 0 混在中间
    const aEmpty = av === '';
    const bEmpty = bv === '';
    if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
    if (numeric) return (Number(av) - Number(bv)) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
});

// 汇总跟随当前筛选：筛了档位/关键词后，卡片数字与表格里的行保持一致，避免两处对不上。
const totals = computed(() => {
  const t = { stocks: filtered.value.length, picks: 0, high: 0, secondary: 0, conditional: 0, excluded: 0 };
  for (const r of filtered.value) {
    t.picks += r.picks;
    t.high += r.high;
    t.secondary += r.secondary;
    t.conditional += r.conditional;
    t.excluded += r.excluded;
  }
  return t;
});

function open(code: string) {
  openStock(router, route, code);
}

// 滚动位置恢复：等数据渲染完（load 的 finally）再滚，否则文档高度不足会被截断。
let pendingScrollY: number | null = null;
async function applyPendingScroll() {
  if (pendingScrollY === null) return;
  const y = pendingScrollY;
  pendingScrollY = null;
  await nextTick();
  window.scrollTo(0, y);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await api.getStockRank();
  } catch (e) {
    rows.value = [];
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    loading.value = false;
    await applyPendingScroll();
  }
}

onMounted(() => {
  const saved = readState();
  if (saved.search) search.value = saved.search;
  if (saved.tier) tierFilter.value = saved.tier;
  if (saved.sortKey) sortKey.value = saved.sortKey;
  if (saved.sortDir) sortDir.value = saved.sortDir;
  pendingScrollY = saved.scrollY && saved.scrollY > 0 ? saved.scrollY : null;
  load();
});

onBeforeUnmount(writeState);
</script>

<template>
  <div class="allstocks">
    <header class="page-head">
      <div>
        <h1>全部入选标的</h1>
        <p class="sub">按个股汇总历史入选情况：入选次数 / 各档数量 / 入选时间范围</p>
      </div>
      <router-link class="ghost-btn" to="/rules">规则释义 →</router-link>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- 汇总（跟随筛选） -->
    <section class="summary-wrap" v-if="rows.length">
      <div class="summary">
        <div class="card"><span class="k">标的数</span><span class="v">{{ totals.stocks }}</span></div>
        <div class="card"><span class="k">入选总次数</span><span class="v">{{ totals.picks }}</span></div>
        <div class="card hi"><span class="k">重点</span><span class="v">{{ totals.high }}</span></div>
        <div class="card se"><span class="k">次级</span><span class="v">{{ totals.secondary }}</span></div>
        <div class="card co"><span class="k">条件</span><span class="v">{{ totals.conditional }}</span></div>
        <div class="card ex"><span class="k">排除</span><span class="v">{{ totals.excluded }}</span></div>
      </div>
      <p class="summary-note" v-if="filterActive">以上数字已按当前筛选统计。</p>
    </section>

    <!-- 筛选：档位下拉 + 关键词搜索 -->
    <section class="filters" v-if="rows.length">
      <label class="tier-filter">
        <span class="fl">档位</span>
        <select v-model="tierFilter" class="tier-select" aria-label="按档位筛选">
          <option v-for="o in TIER_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <input
        class="search-input"
        type="search"
        v-model="search"
        placeholder="搜索代码 / 名称 / 板块"
        aria-label="搜索标的"
      />
      <button v-if="filterActive" class="clear-btn" type="button" @click="resetFilters">清除筛选</button>
      <span class="meta"
        >共 {{ sorted.length }} 只<template v-if="tierFilter"> · 档位「{{ TIER_LABELS[tierFilter] }}」</template> · 当前排序：<b>{{
          COLS.find((c) => c.key === sortKey)?.label.replace(/<br \/>/g, '')
        }}</b>
        {{ sortDir === 'desc' ? '（降序）' : '（升序）' }} · 点列头切换</span
      >
    </section>

    <p v-else-if="loading" class="hint">加载汇总中…</p>

    <!-- 汇总表：固定列宽，任何窗口宽度都不横向滚动 -->
    <section class="table-wrap" v-if="!loading && sorted.length">
      <table class="grid">
        <colgroup>
          <col style="width: 8%" />
          <col style="width: 10%" />
          <col style="width: 11%" />
          <col style="width: 7%" />
          <col style="width: 5%" />
          <col style="width: 5%" />
          <col style="width: 5%" />
          <col style="width: 5%" />
          <col style="width: 6%" />
          <col style="width: 6%" />
          <col style="width: 6%" />
          <col style="width: 13%" />
          <col style="width: 13%" />
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="c in COLS"
              :key="c.key"
              :class="{ num: c.num, ctr: !c.num, sorted: sortKey === c.key, active: !!tierFilter && tierFilter === c.key }"
              :title="c.tip"
            >
              <button class="th-btn" @click="toggleSort(c.key)">
                <span v-html="c.label"></span>
                <span class="arrow">{{ sortKey === c.key ? (sortDir === 'desc' ? '▼' : '▲') : '' }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in sorted" :key="r.code" @click="open(r.code)">
            <td class="code" data-label="代码">{{ r.code }}</td>
            <td class="name" data-label="名称">{{ r.name ?? '—' }}</td>
            <td class="sector" data-label="板块">{{ r.sector ?? '—' }}</td>
            <td class="num strong" data-label="入选次数">{{ r.picks }}</td>
            <td class="num t-hi" data-label="重点">{{ r.high || '—' }}</td>
            <td class="num t-se" data-label="次级">{{ r.secondary || '—' }}</td>
            <td class="num t-co" data-label="条件">{{ r.conditional || '—' }}</td>
            <td class="num t-ex" data-label="排除">{{ r.excluded || '—' }}</td>
            <td class="num perf" :class="perfClass(r.n1_avg)" data-label="N1 平均" :title="avgTitle(r, 'n1')">
              {{ fmtPct(r.n1_avg) }}
            </td>
            <td class="num perf" :class="perfClass(r.n2_avg)" data-label="N2 平均" :title="avgTitle(r, 'n2')">
              {{ fmtPct(r.n2_avg) }}
            </td>
            <td class="num perf" :class="perfClass(r.n3_avg)" data-label="N3 平均" :title="avgTitle(r, 'n3')">
              {{ fmtPct(r.n3_avg) }}
            </td>
            <td class="mono ctr" data-label="最近入选">{{ r.last_anchor }}</td>
            <td class="mono ctr" data-label="首次入选">{{ r.first_anchor }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-else-if="!error && !loading && filterActive" class="hint">
      没有符合当前筛选条件的标的<template v-if="search.trim()">（关键词「{{ search }}」）</template
      ><template v-if="tierFilter">（档位：{{ TIER_LABELS[tierFilter] }}）</template>。
      <button class="clear-btn" type="button" @click="resetFilters">清除筛选</button>
    </p>
    <p v-else-if="!error && !loading" class="hint">暂无入选记录。</p>

    <p class="legend" v-if="sorted.length">
      数量列（入选次数 / 重点 / 次级 / 条件 / 排除）点列头先按「多 → 少」排序；时间列默认「近 → 远」。
      <b>N1 / N2 / N3 平均</b> = 该票<b>每一次</b>入选后第 1 / 2 / 3 个交易日的涨跌幅（各自相对入选价）取算术平均，
      悬停单元格可看样本数；暂无样本显示 —，排序时恒排在最后。涨 = 红，跌 = 绿。档位含义见
      <router-link to="/rules">规则释义</router-link>。
    </p>
  </div>
</template>

<style scoped>
.allstocks { display: flex; flex-direction: column; gap: 16px; }
.page-head { display: flex; align-items: center; justify-content: space-between; }
.page-head h1 { font-size: 22px; margin: 0; }
.sub { color: var(--muted); margin: 4px 0 0; font-size: 13px; }
.ghost-btn { color: var(--accent); text-decoration: none; font-size: 14px; }
.ghost-btn:hover { text-decoration: underline; }

.summary-wrap { display: flex; flex-direction: column; gap: 8px; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.summary-note { margin: 0; font-size: 12px; color: var(--muted); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.card .k { font-size: 12px; color: var(--muted); }
.card .v { font-size: 18px; font-weight: 700; }
.card.hi .v { color: #ff7b72; }
.card.se .v { color: #e3b341; }
.card.co .v { color: #79c0ff; }
.card.ex .v { color: #8b949e; }

.filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.tier-filter { display: inline-flex; align-items: center; gap: 8px; }
.tier-filter .fl { font-size: 12px; color: var(--muted); }
.tier-select {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 999px; padding: 7px 12px; font: inherit; font-size: 13px; cursor: pointer;
}
.tier-select:focus { outline: none; border-color: var(--accent); }
.clear-btn {
  background: none; border: none; padding: 0; font: inherit; font-size: 12.5px;
  color: var(--accent); cursor: pointer;
}
.clear-btn:hover { text-decoration: underline; }
.search-input {
  min-width: 200px; flex: 0 1 260px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 13px;
}
.search-input:focus { outline: none; border-color: var(--accent); }
.meta { font-size: 12px; color: var(--muted); }

.table-wrap { overflow: hidden; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 7px; text-align: left; overflow-wrap: anywhere; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; line-height: 1.3; padding: 0; }
.grid thead th.sorted { color: var(--accent); }
/* 当前筛选的档位列：加一条下边框做提示，避免「筛了却不知道在看哪一列」 */
.grid thead th.active { box-shadow: inset 0 -2px 0 0 var(--accent); }
.grid tbody tr { border-top: 1px solid var(--border); cursor: pointer; }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 12px; }
.grid th.ctr, .grid td.ctr { text-align: center; }
.grid .strong { font-weight: 700; }
.grid .t-hi { color: #ff7b72; }
.grid .t-se { color: #e3b341; }
.grid .t-co { color: #79c0ff; }
.grid .t-ex { color: var(--muted); }
/* 收益列：红涨绿跌（全站惯例），无样本时退化为灰色普通字 */
.grid .perf { font-weight: 600; }
.grid .perf.up { color: #ff7b72; }
.grid .perf.down { color: #3fb950; }
.grid .perf.flat { color: var(--muted); }
.grid .perf.muted { color: var(--muted); font-weight: 400; }
.grid .code { white-space: nowrap; font-weight: 600; color: var(--accent); }
.grid .name { font-weight: 500; }
.grid .sector { color: var(--muted); }
.grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; white-space: nowrap; }

.th-btn {
  width: 100%; display: flex; align-items: center; gap: 4px;
  background: none; border: none; color: inherit; font: inherit; cursor: pointer;
  padding: 8px 7px; text-align: left;
}
.grid th.num .th-btn { justify-content: flex-end; }
.grid th.ctr .th-btn { justify-content: center; }
.th-btn .arrow { font-size: 9px; color: var(--accent); }

.legend { color: var(--muted); font-size: 12px; line-height: 1.75; margin: 0; }
.legend a { color: var(--accent); text-decoration: none; }
.legend a:hover { text-decoration: underline; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }

/* 窄屏：表格翻转成卡片 */
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
    padding: 6px 12px; border: none; text-align: left;
  }
  .grid td::before {
    content: attr(data-label); color: var(--muted); font-size: 12px; font-weight: 600;
    flex: 0 0 auto; margin-right: 8px;
  }
  .grid td.num { text-align: left; }
  .search-input { flex-basis: 100%; }
  .tier-filter { flex-basis: 100%; }
  .tier-select { flex: 1; }
}
</style>
