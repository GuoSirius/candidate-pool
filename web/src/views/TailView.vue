<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import type { TailRun, TailRunDetail, TailPick, TailMode } from '../api/types';
import { fmtNum, fmtPct, fmtCap, perfClass } from '../utils/format';
import { useColumnSort, type SortValue } from '../utils/sort';
import PageHeader from '../components/PageHeader.vue';

const route = useRoute();

const runs = ref<TailRun[]>([]);
const detail = ref<TailRunDetail | null>(null);
const loading = ref(false);
const error = ref('');

/** （交易日, 口径）组合：下拉里一个选项即一个口径，避免「某日只有观察」的歧义。 */
const combos = computed(() => {
  return [...runs.value]
    .sort((a, b) =>
      a.trade_date === b.trade_date
        ? (b.mode === 'formal' ? 1 : 0) - (a.mode === 'formal' ? 1 : 0)
        : a.trade_date < b.trade_date ? 1 : -1,
    )
    .map((r) => ({ date: r.trade_date, mode: r.mode }));
});
const selected = ref('');

function comboKey(date: string, mode: TailMode): string {
  return `${date}|${mode}`;
}
function parseSelected(): { date: string; mode: TailMode } {
  const [date, mode] = selected.value.split('|');
  return { date, mode: (mode as TailMode) || 'formal' };
}

// —— 列表筛选 / 排序 / 分页 ——
const search = ref('');
const pageSize = ref<number>(50);
const page = ref(1);

/**
 * 六维子分按「这分是谁给的」分两组：
 *   · 个股自身 65 分 = 动能 30 + 量能 20 + 位置 15 —— 这只票自己在走出来的证据，**重点看这组**；
 *   · 环境与质量 35 分 = 板块 15 + 均线 10 + 换手 10 —— 板块与流动性给的背景分，靠它撑起来的高分不可信。
 * 组内按权重降序（权重大的先看）；顺序即渲染顺序，原始值已乘权重（0..权重）。
 * ⚠️ 与 eod/lib/report.js 的 SCORE_GROUPS 是同一份口径，改一处必须改另一处。
 */
const SCORE_GROUPS: {
  key: string; label: string; max: number; cls: string;
  keys: { key: string; label: string }[];
}[] = [
  {
    key: 'self', label: '个股自身', max: 65, cls: 'self',
    keys: [
      { key: 'tailMomentum', label: '动能' },
      { key: 'volume', label: '量能' },
      { key: 'position', label: '位置' },
    ],
  },
  {
    key: 'ctx', label: '环境质量', max: 35, cls: 'ctx',
    keys: [
      { key: 'sector', label: '板块' },
      { key: 'avgLine', label: '均线' },
      { key: 'turnoverFit', label: '换手' },
    ],
  },
];
/** 扁平化：归一化 / 取值循环用（顺序 = 渲染顺序）。 */
const SCORE_KEYS = SCORE_GROUPS.flatMap((g) => g.keys);

/** 复盘口径只算这 7 个检查点（N4/N6/N8 不落库）。 */
const N_KEYS = ['n1', 'n2', 'n3', 'n5', 'n7', 'n9', 'n10'] as const;

const filteredPicks = computed(() => {
  const q = search.value.trim().toLowerCase();
  const src = detail.value?.picks ?? [];
  if (!q) return src;
  return src.filter((p) =>
    `${p.code} ${(p.name ?? '')} ${(p.sector ?? '')}`.toLowerCase().includes(q),
  );
});

type PickSortKey =
  | 'code' | 'name' | 'sector' | 'total' | 'chg_pct'
  | 'vol_ratio' | 'turnover' | 'float_cap_yi' | 'sector_median_chg';

const {
  sortKey: pickSortKey,
  sortDir: pickSortDir,
  toggle: togglePickSort,
  clearSort: clearPickSort,
  sortRows: sortPickRows,
} = useColumnSort<PickSortKey>({
  initialKey: null,
  numericKeys: ['total', 'chg_pct', 'vol_ratio', 'turnover', 'float_cap_yi', 'sector_median_chg'],
});

function pickSortValue(p: TailPick, k: PickSortKey): SortValue {
  return p[k];
}
const sortedPicks = computed(() => sortPickRows(filteredPicks.value, pickSortValue));

const totalPages = computed(() =>
  Math.max(1, Math.ceil(sortedPicks.value.length / pageSize.value)),
);
const pagedPicks = computed(() => {
  if (pageSize.value >= sortedPicks.value.length) return sortedPicks.value;
  const s = (page.value - 1) * pageSize.value;
  return sortedPicks.value.slice(s, s + pageSize.value);
});

function rowNo(i: number): number {
  return (page.value - 1) * pageSize.value + i + 1;
}
function pickArrow(k: PickSortKey): string {
  if (pickSortKey.value !== k) return '';
  return pickSortDir.value === 'desc' ? '▼' : '▲';
}

/** 子分柱归一化：按该维度在全部候选中的最大值比，缺值记 0。 */
const scoreMax = computed(() => {
  const m: Record<string, number> = {};
  for (const k of SCORE_KEYS) m[k.key] = 0;
  for (const p of filteredPicks.value) {
    const sc = p.score;
    if (!sc) continue;
    for (const k of SCORE_KEYS) {
      const v = sc[k.key];
      if (typeof v === 'number' && v > m[k.key]) m[k.key] = v;
    }
  }
  return m;
});
function scoreVal(p: TailPick, key: string): number {
  const v = p.score?.[key];
  return typeof v === 'number' ? v : 0;
}
function scorePct(p: TailPick, key: string): number {
  const max = scoreMax.value[key] || 1;
  return Math.round((scoreVal(p, key) / max) * 100);
}

// —— 漏斗（来自 run.stats）——
const funnel = computed(() => {
  const s = detail.value?.run.stats;
  if (!s) return null;
  const snap = s.snapshotCount ?? 0;
  const pre = s.prePassCount ?? 0;
  const cand = s.candidateCount ?? 0;
  return {
    snap, pre, cand,
    prePassRate: snap ? (pre / snap) * 100 : 0,
    candRate: pre ? (cand / pre) * 100 : 0,
    candOfSnap: snap ? (cand / snap) * 100 : 0,
  };
});

async function loadRuns() {
  error.value = '';
  try {
    runs.value = await api.getTailRuns(100);
    if (!runs.value.length) return;
    // 优先选中最新「正式」口径，没有则第一个组合；URL 带 ?date=&mode= 时尊重之（来自记录页跳转）
    const qDate = typeof route.query.date === 'string' ? route.query.date : '';
    const qMode = typeof route.query.mode === 'string' ? route.query.mode : '';
    const fromQuery =
      qDate && (qMode === 'formal' || qMode === 'observe')
        ? runs.value.find((r) => r.trade_date === qDate && r.mode === qMode)
        : undefined;
    const formal = runs.value.find((r) => r.mode === 'formal');
    const pick = fromQuery ?? formal ?? runs.value[0];
    selected.value = comboKey(pick.trade_date, pick.mode);
    await loadDetail();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  }
}

async function loadDetail() {
  if (!selected.value) return;
  loading.value = true;
  error.value = '';
  const { date, mode } = parseSelected();
  try {
    detail.value = await api.getTailRun(date, mode);
    page.value = 1;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

function onComboChange() {
  page.value = 1;
  loadDetail();
}
function onPageSizeChange() {
  page.value = 1;
}

onMounted(loadRuns);
</script>

<template>
  <div class="tail">
    <PageHeader title="尾盘候选" sub="盘中（14:50 截点）六维打分筛选：个股自身 65 分（重点看）+ 环境与质量 35 分">
      <template #actions>
        <router-link class="ghost-btn" to="/tail/review">尾盘复盘 →</router-link>
        <router-link class="ghost-btn" to="/tail/diff">口径对照 →</router-link>
      </template>
    </PageHeader>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- 交易日 + 口径选择 -->
    <section class="anchors" v-if="combos.length">
      <label class="anchor-select">
        <span class="lbl">交易日 / 口径</span>
        <select v-model="selected" @change="onComboChange">
          <option v-for="c in combos" :key="comboKey(c.date, c.mode)" :value="comboKey(c.date, c.mode)">
            {{ c.date }} · {{ c.mode === 'formal' ? '正式' : '观察' }}
            （{{ (runs.find((r) => r.trade_date === c.date && r.mode === c.mode)?.candidate_count ?? 0) }} 只）
          </option>
        </select>
        <span class="meta">共 {{ combos.length }} 个运行</span>
      </label>
    </section>

    <p v-else-if="!error && !loading" class="hint">暂无尾盘运行数据。</p>

    <!-- 概览卡 -->
    <section class="summary" v-if="detail">
      <div class="card"><span class="k">截点</span><span class="v">{{ detail.run.cut_at ?? '—' }}</span></div>
      <div class="card hi"><span class="k">候选数</span><span class="v">{{ fmtNum(detail.run.candidate_count, 0) }}</span></div>
      <div class="card"><span class="k">行业组</span><span class="v">{{ fmtNum(detail.run.group_count, 0) }}</span></div>
      <div class="card"><span class="k">初筛通过</span><span class="v">{{ fmtNum(detail.run.pre_pass_count, 0) }}</span></div>
      <div class="card"><span class="k">全市场快照</span><span class="v">{{ fmtNum(detail.run.snapshot_count, 0) }}</span></div>
      <div class="card"><span class="k">运行次数</span><span class="v">{{ (detail.run.runs?.length ?? 0) }}</span></div>
    </section>

    <!-- 漏斗 -->
    <section class="funnel" v-if="funnel">
      <h3 class="sec-title">筛选漏斗</h3>
      <div class="funnel-stages">
        <div class="fstage">
          <div class="flabel"><span>全市场快照</span><b>{{ fmtNum(funnel.snap, 0) }}</b></div>
          <div class="fbar"><i class="f1" :style="{ width: '100%' }"></i></div>
        </div>
        <div class="fstage">
          <div class="flabel"><span>初筛通过</span><b>{{ fmtNum(funnel.pre, 0) }}</b></div>
          <div class="fbar"><i class="f2" :style="{ width: (funnel.snap ? (funnel.pre / funnel.snap) * 100 : 0) + '%' }"></i></div>
          <div class="fdrop">通过率 {{ fmtPct(funnel.prePassRate) }}</div>
        </div>
        <div class="fstage">
          <div class="flabel"><span>候选入选</span><b>{{ fmtNum(funnel.cand, 0) }}</b></div>
          <div class="fbar"><i class="f3" :style="{ width: (funnel.snap ? (funnel.cand / funnel.snap) * 100 : 0) + '%' }"></i></div>
          <div class="fdrop">占快照 {{ fmtPct(funnel.candOfSnap) }}</div>
        </div>
      </div>
    </section>

    <!-- 筛选 + 搜索 + 每页条数 -->
    <section class="filters" v-if="detail && filteredPicks.length">
      <input
        class="search-input"
        type="search"
        v-model="search"
        placeholder="搜索代码 / 名称 / 板块"
        aria-label="搜索尾盘候选"
      />
      <label class="ps-select">
        <span>每页</span>
        <select v-model.number="pageSize" @change="onPageSizeChange">
          <option :value="20">20</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="999999">全部</option>
        </select>
      </label>
      <button v-if="pickSortKey" class="clear-sort" type="button" @click="clearPickSort">
        已按「{{ pickSortKey }}」{{ pickSortDir === 'desc' ? '降序' : '升序' }} · 点此恢复默认（按总分）
      </button>
    </section>

    <p class="legend" v-if="detail">
      分项得分分两组：<b class="lg-self">个股自身 65 分</b>（动能 30 + 量能 20 + 位置 15，重点看这组）· <b class="lg-ctx">环境与质量 35 分</b>（板块 15 + 均线 10 + 换手 10，靠它撑起来的高分不可信）。总分 = 两组之和；子分柱按该维度在列表中最大值归一。复盘红涨绿跌；N 列仅 N1/N2/N3/N5/N7/N9/N10 七个检查点。
    </p>

    <!-- 候选表（宽表：11 逻辑列 → 移动端横向滚动，不翻转） -->
    <section class="table-wrap" v-if="!loading && pagedPicks.length">
      <table class="grid">
        <colgroup>
          <col style="width: 3.5%" />
          <col style="width: 7%" />
          <col style="width: 7%" />
          <col style="width: 5.5%" />
          <col style="width: 19%" />
          <col style="width: 6.5%" />
          <col style="width: 6%" />
          <col style="width: 6%" />
          <col style="width: 7%" />
          <col style="width: 7%" />
          <col style="width: 15.5%" />
        </colgroup>
        <thead>
          <tr>
            <th class="ctr idx">序号</th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'code' }"><button class="th-btn" @click="togglePickSort('code')">代码<span class="arrow">{{ pickArrow('code') }}</span></button></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'name' }"><button class="th-btn" @click="togglePickSort('name')">名称<span class="arrow">{{ pickArrow('name') }}</span></button></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'sector' }"><button class="th-btn" @click="togglePickSort('sector')">板块<span class="arrow">{{ pickArrow('sector') }}</span></button></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'total' }"><button class="th-btn" @click="togglePickSort('total')">总分<span class="arrow">{{ pickArrow('total') }}</span></button></th>
            <th>分项得分<span class="thsub">自身 65 · 环境 35</span></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'chg_pct' }"><button class="th-btn" @click="togglePickSort('chg_pct')">涨跌幅<span class="arrow">{{ pickArrow('chg_pct') }}</span></button></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'vol_ratio' }"><button class="th-btn" @click="togglePickSort('vol_ratio')">量比<span class="arrow">{{ pickArrow('vol_ratio') }}</span></button></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'turnover' }"><button class="th-btn" @click="togglePickSort('turnover')">换手率<span class="arrow">{{ pickArrow('turnover') }}</span></button></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'float_cap_yi' }"><button class="th-btn" @click="togglePickSort('float_cap_yi')">流通市值<span class="arrow">{{ pickArrow('float_cap_yi') }}</span></button></th>
            <th :class="{ sortable: true, sorted: pickSortKey === 'sector_median_chg' }"><button class="th-btn" @click="togglePickSort('sector_median_chg')">板块强度<span class="arrow">{{ pickArrow('sector_median_chg') }}</span></button></th>
            <th>复盘 N1~N10</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in pagedPicks" :key="p.code">
            <td class="ctr idx" data-label="序号">{{ rowNo(i) }}</td>
            <td class="code" data-label="代码">
              {{ p.code }}
              <span class="board" v-if="p.board_label">{{ p.board_label }}</span>
            </td>
            <td class="name" data-label="名称">{{ p.name ?? '—' }}</td>
            <td class="sector" data-label="板块">{{ p.sector ?? '—' }}</td>
            <td class="num total" data-label="总分">{{ fmtNum(p.total) }}</td>
            <td class="scores" data-label="分项得分">
              <div class="scgrp" v-for="g in SCORE_GROUPS" :key="g.key" :class="'g-' + g.cls">
                <div class="scgcap"><span>{{ g.label }}</span><span>{{ g.max }}</span></div>
                <div class="scrow" v-for="s in g.keys" :key="s.key">
                  <span class="scl">{{ s.label }}</span>
                  <span class="scbar"><i :style="{ width: scorePct(p, s.key) + '%' }"></i></span>
                  <span class="scv">{{ fmtNum(scoreVal(p, s.key)) }}</span>
                </div>
              </div>
            </td>
            <td class="num" data-label="涨跌幅" :class="perfClass(p.chg_pct)">{{ fmtPct(p.chg_pct) }}</td>
            <td class="num" data-label="量比">{{ fmtNum(p.vol_ratio) }}</td>
            <td class="num" data-label="换手率">{{ fmtPct(p.turnover) }}</td>
            <td class="num" data-label="流通市值">{{ fmtCap((p.float_cap_yi ?? 0) * 1e8) }}</td>
            <td class="num" data-label="板块强度" :class="perfClass(p.sector_median_chg)">{{ fmtPct(p.sector_median_chg) }}</td>
            <td class="ncols" data-label="复盘">
              <span
                v-for="k in N_KEYS"
                :key="k"
                class="nchip"
                :class="perfClass(p.perf ? p.perf[k] : null)"
              >{{ k.toUpperCase() }} {{ p.perf ? fmtPct(p.perf[k]) : '—' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 分页 -->
    <div class="pager" v-if="!loading && totalPages > 1">
      <button class="pg-btn" :disabled="page <= 1" @click="page--">← 上一页</button>
      <span class="pg-info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ filteredPicks.length }} 只</span>
      <button class="pg-btn" :disabled="page >= totalPages" @click="page++">下一页 →</button>
    </div>

    <p v-else-if="loading" class="hint">加载候选列表…</p>
    <p v-else-if="!error && detail && search.trim() && filteredPicks.length === 0" class="hint">无匹配「{{ search }}」的标的。</p>
    <p v-else-if="!error && detail" class="hint">该运行暂无候选记录。</p>
  </div>
</template>

<style scoped>
.tail { display: flex; flex-direction: column; gap: 16px; }

.anchors { display: flex; align-items: center; }
.anchor-select { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
.anchor-select .lbl { font-weight: 600; color: var(--text); }
.anchor-select select {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 10px; padding: 7px 12px; font: inherit; font-size: 13px; min-width: 230px;
  cursor: pointer; max-width: 360px;
}
.anchor-select select:focus { outline: none; border-color: var(--accent); }
.anchor-select .meta { font-size: 12px; }

.summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.card .k { font-size: 12px; color: var(--muted); }
.card .v { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.card.hi .v { color: #ff7b72; }

/* 漏斗：三段柱 + 转化率 */
.funnel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.sec-title { margin: 0 0 12px; font-size: 14px; font-weight: 700; color: var(--text); }
.funnel-stages { display: flex; flex-direction: column; gap: 14px; }
.fstage { display: grid; grid-template-columns: 120px 1fr; grid-template-areas: 'label bar' 'drop bar'; gap: 2px 14px; align-items: center; }
.flabel { grid-area: label; display: flex; flex-direction: column; }
.flabel span { font-size: 12px; color: var(--muted); }
.flabel b { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.fbar { grid-area: bar; height: 18px; background: var(--bg); border-radius: 6px; overflow: hidden; }
.fbar i { display: block; height: 100%; border-radius: 6px; transition: width 0.3s; }
.fbar .f1 { background: #8b949e; }
.fbar .f2 { background: #79c0ff; }
.fbar .f3 { background: #ff7b72; }
.fdrop { grid-area: drop; font-size: 11.5px; color: var(--muted); }

.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.search-input {
  flex: 0 1 260px; background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 13px;
}
.search-input:focus { outline: none; border-color: var(--accent); }
.ps-select { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.ps-select select { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 13px; }
.ps-select select:focus { outline: none; border-color: var(--accent); }
.clear-sort { background: none; border: none; padding: 0; font: inherit; font-size: 12.5px; color: var(--accent); cursor: pointer; }
.clear-sort:hover { text-decoration: underline; }

.legend { color: var(--muted); font-size: 12px; line-height: 1.75; margin: 0; }
.legend .lg-self { color: var(--accent); }
.legend .lg-ctx { color: var(--muted); }

/* 宽表：移动端不翻转，横向滚动 */
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; min-width: 920px; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 7px; text-align: left; overflow-wrap: anywhere; vertical-align: top; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; line-height: 1.3; white-space: nowrap; }
.grid thead th .thsub { display: block; font-size: 10px; font-weight: 400; color: var(--muted); }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 12px; }
.grid .idx { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11.5px; white-space: nowrap; text-align: center; }
.grid th.ctr, .grid td.ctr { text-align: center; }
.grid .code { white-space: nowrap; font-weight: 600; color: var(--accent); }
.grid .code .board { margin-left: 4px; font-size: 10px; color: var(--muted); font-weight: 400; }
.grid .name { font-weight: 500; white-space: nowrap; }
.grid .sector, .grid .reason { color: var(--muted); white-space: nowrap; }
.grid .total { font-weight: 700; }
.up { color: #ff7b72; }
.down { color: #3fb950; }
.flat { color: var(--text); }
.muted { color: var(--muted); }

/* 六维分项：竖向 slim 条，按「个股自身 65 / 环境质量 35」切成两块 ——
   左栏 2px 竖线 + 组标题行，让「哪几个子分该当真」不靠读文字也能看出来 */
.scores { white-space: nowrap; }
.scgrp { padding-left: 6px; border-left: 2px solid var(--border); }
.scgrp + .scgrp { margin-top: 5px; }
.scgrp.g-self { border-left-color: var(--accent); }
.scgcap { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; line-height: 1.6; letter-spacing: 0.02em; }
.scgrp.g-self .scgcap { color: var(--accent); font-weight: 700; }
.scgrp.g-ctx .scgcap { color: var(--muted); }
.scgrp.g-self .scv { font-weight: 600; }
.scgrp.g-ctx .scbar i { background: var(--muted); }
.scrow { display: grid; grid-template-columns: 28px 1fr 34px; align-items: center; gap: 4px; line-height: 1.5; }
.scl { font-size: 11px; color: var(--muted); }
.scbar { height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.scbar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
.scv { font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; color: var(--text); }

/* 复盘 N 列：7 个检查点小芯片，红涨绿跌 */
.ncols { display: flex; flex-wrap: wrap; gap: 3px; }
.nchip { font-size: 10.5px; padding: 1px 4px; border-radius: 5px; background: var(--bg); font-variant-numeric: tabular-nums; white-space: nowrap; }

.pager { display: flex; align-items: center; justify-content: center; gap: 14px; }
.pg-btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 6px 14px; cursor: pointer; font: inherit; font-size: 13px; }
.pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pg-info { font-size: 13px; color: var(--muted); }

.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; }
.ghost-btn:hover { text-decoration: underline; }
.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
