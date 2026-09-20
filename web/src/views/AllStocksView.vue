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
  | 'last_n1'
  | 'last_n2'
  | 'last_n3'
  | 'last_anchor'
  | 'first_anchor';

/**
 * N 列的两种口径：
 * - last：只看「最近一次入选」那一次的表现（单次快照，回答「这只票眼下什么状态」）；
 * - avg：把历次入选各自的表现取算术平均（跨时间平均，回答「这只票长期靠不靠谱」）。
 * 两者用途不同、互相不能替代，所以保留切换而不是二选一。
 */
type NCaliber = 'last' | 'avg';

const nCaliber = ref<NCaliber>('last');

/** 第 cy 个周期在当前口径下对应的数据字段名，同时也是该列的排序键。 */
function nKey(cy: number): SortKey {
  return (nCaliber.value === 'last' ? `last_n${cy}` : `n${cy}_avg`) as SortKey;
}

const N_CYCLES = [1, 2, 3] as const;
const N_KEYS: SortKey[] = ['last_n1', 'last_n2', 'last_n3', 'n1_avg', 'n2_avg', 'n3_avg'];

const NUM_KEYS: SortKey[] = [
  'picks',
  'high',
  'secondary',
  'conditional',
  'excluded',
  ...N_KEYS,
];

interface Col {
  key: SortKey;
  label: string;
  num?: boolean;
  tip?: string;
}

const AVG_TIP =
  '该票每一次入选后第 N 个交易日的涨跌幅，各自相对自己的入选价，再取算术平均（跨时间平均，看长期）';
const LAST_TIP =
  '该票最近一次入选后第 N 个交易日的涨跌幅，相对那次入选价（单次快照，看眼下）';

/** 表头列：固定列 + 中间三个随口径切换的 N 列 + 时间列。列数与列宽保持不变。 */
const COLS = computed<Col[]>(() => {
  const tag = nCaliber.value === 'last' ? '最近' : '平均';
  const tip = nCaliber.value === 'last' ? LAST_TIP : AVG_TIP;
  const nCols: Col[] = N_CYCLES.map((cy) => ({ key: nKey(cy), label: `N${cy}<br />${tag}`, num: true, tip }));
  return [
    { key: 'code', label: '代码' },
    { key: 'name', label: '名称' },
    { key: 'sector', label: '板块' },
    { key: 'picks', label: '入选<br />次数', num: true, tip: '该票在全部批次中的入选总次数' },
    { key: 'high', label: '重点', num: true },
    { key: 'secondary', label: '次级', num: true },
    { key: 'conditional', label: '条件', num: true },
    { key: 'excluded', label: '排除', num: true },
    ...nCols,
    { key: 'last_anchor', label: '最近入选', tip: '默认按此列倒序（最近入选的标的最前）' },
    { key: 'first_anchor', label: '首次入选' },
  ];
});

const nLabel = computed(() => (nCaliber.value === 'last' ? '最近' : '平均'));

/** 切换口径；若当前正按某个 N 列排序，跟着切到同周期的新口径列，避免排序悄悄失效。 */
function setCaliber(c: NCaliber) {
  if (nCaliber.value === c) return;
  const idx = N_KEYS.indexOf(sortKey.value);
  nCaliber.value = c;
  if (idx >= 0) sortKey.value = nKey((idx % 3) + 1);
  writeState();
}

// 默认：按最近入选时间倒序
const sortKey = ref<SortKey>('last_anchor');
const sortDir = ref<'asc' | 'desc'>('desc');

// —— 列表状态保持：进个股详情再返回时，恢复搜索 / 档位 / 排序 / 滚动位置 ——
const STATE_KEY = 'cp:allstocks:state';
interface AllState {
  search?: string;
  tier?: '' | Tier;
  caliber?: NCaliber;
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
      caliber: nCaliber.value,
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

/** 当前口径下第 cy 个周期该行的取值（缺数据为 null）。 */
function nVal(r: StockRankRow, cy: number): number | null {
  const v = (r as unknown as Record<string, number | null | undefined>)[nKey(cy)];
  return v === undefined ? null : v;
}

/**
 * N 列悬浮说明：把「口径 + 参照的锚定日 + 样本数」讲清楚。
 * 平均口径下三个周期的样本数可能不同（近期入选的还没走到第 2/3 个交易日），所以逐列显示。
 */
function nTitle(r: StockRankRow, cy: number): string {
  const v = nVal(r, cy);
  if (nCaliber.value === 'avg') {
    const n = (r as unknown as Record<string, number | undefined>)[`n${cy}_n`] ?? 0;
    return v === null
      ? `N${cy} 平均：暂无可用样本（入选后第 ${cy} 个交易日的行情还没出来）`
      : `N${cy} 平均：${fmtPct(v)}｜样本 ${n} 次入选（每次相对各自的入选价）`;
  }
  if (v === null) {
    return `N${cy}（最近一次入选 ${r.last_anchor}）：暂无数据 —— 该次入选后第 ${cy} 个交易日的行情还没出来`;
  }
  return `N${cy}（最近一次入选 ${r.last_anchor}）：${fmtPct(v)}，相对该次入选价`;
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
  // 先恢复口径再恢复排序键：排序键可能是某个 N 列，两者要配套
  if (saved.caliber) nCaliber.value = saved.caliber;
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
      <div class="caliber" role="group" aria-label="N 列收益口径">
        <span class="fl">收益口径</span>
        <button
          type="button"
          :class="{ on: nCaliber === 'last' }"
          title="只看最近一次入选那一次的表现（单次快照，看眼下状态）"
          @click="setCaliber('last')"
        >
          最近一次
        </button>
        <button
          type="button"
          :class="{ on: nCaliber === 'avg' }"
          title="把历次入选各自的表现取算术平均（跨时间平均，看长期表现）"
          @click="setCaliber('avg')"
        >
          历史平均
        </button>
      </div>
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
            <td
              v-for="cy in N_CYCLES"
              :key="cy"
              class="num perf"
              :class="perfClass(nVal(r, cy))"
              :data-label="`N${cy} ${nLabel}`"
              :title="nTitle(r, cy)"
            >
              {{ fmtPct(nVal(r, cy)) }}
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
/* N 列口径切换：两段式，选中项高亮，一眼看出当前在看哪种口径 */
.caliber { display: inline-flex; align-items: center; gap: 8px; }
.caliber .fl { font-size: 12px; color: var(--muted); }
.caliber button {
  background: var(--surface); border: 1px solid var(--border); color: var(--muted);
  font: inherit; font-size: 12.5px; padding: 6px 12px; cursor: pointer;
}
.caliber button:first-of-type { border-radius: 999px 0 0 999px; }
.caliber button:last-of-type { border-radius: 0 999px 999px 0; margin-left: -8px; }
.caliber button.on { background: rgba(31,111,235,0.16); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.caliber button:not(.on):hover { color: var(--text); }
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
  .caliber { flex-basis: 100%; }
  .caliber button { flex: 1; }
}
</style>
