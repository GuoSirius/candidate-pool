<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, ApiError } from '../api/client';
import type { StatsResult, HorizonStat, TimelinePoint } from '../api/types';
import { fmtPct, perfClass } from '../utils/format';
import { todayCN, monthsAgoCN } from '../utils/date';
import { useColumnSort, type SortValue } from '../utils/sort';
import {
  HORIZONS,
  H_LABEL,
  H_COLOR,
  H_SHORT,
  H_LONG,
  H_COMMON,
  timelineAvg,
  type Horizon,
} from '../constants/glossary';
import TierBadge from '../components/TierBadge.vue';
import PageHeader from '../components/PageHeader.vue';

const stats = ref<StatsResult | null>(null);
const loading = ref(false);
const error = ref<string>('');

// —— 区间过滤：默认「最近一个月」（复盘以近期命中率为主，历史可用「全部」放开）——
type RangeKey = 'm1' | 'm3' | 'all' | 'custom';
const RANGE_PRESETS: Array<{ key: RangeKey; label: string; months: number }> = [
  { key: 'm1', label: '近一月', months: 1 },
  { key: 'm3', label: '近三月', months: 3 },
  { key: 'all', label: '全部', months: 0 },
];
const preset = ref<RangeKey>('m1');
const from = ref(monthsAgoCN(1));
const to = ref(todayCN());

async function load() {
  loading.value = true;
  error.value = '';
  try {
    stats.value = await api.getStats(from.value || undefined, to.value || undefined);
  } catch (e) {
    stats.value = null;
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function applyPreset(p: { key: RangeKey; months: number }) {
  preset.value = p.key;
  from.value = monthsAgoCN(p.months);
  to.value = monthsAgoCN(p.months) === '' ? '' : todayCN();
  load();
}

function applyRange() {
  preset.value = 'custom';
  load();
}

// —— 走势图：可勾选显示的周期序列（sessionStorage 记忆）——
// key 带版本号：默认展示项从「全部 7 条」收敛为 N1/N2/N3/N5 后，
// 用新 key 让旧的本地记忆自然失效，否则老用户仍会被旧值覆盖。
const ACTIVE_KEY = 'cp:stats:horizons:v2';
const ALL_H: Horizon[] = [...HORIZONS];

function readActive(): Horizon[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || 'null') as unknown;
    if (Array.isArray(raw)) {
      const ok = raw.filter((h): h is Horizon => (HORIZONS as readonly string[]).includes(String(h)));
      if (ok.length) return ok;
    }
  } catch {
    /* 隐私模式等读取失败时忽略 */
  }
  return [...H_COMMON];
}

const active = ref<Horizon[]>(readActive());

function persistActive() {
  try {
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(active.value));
  } catch {
    /* 写入失败忽略 */
  }
}

function isActive(h: Horizon): boolean {
  return active.value.includes(h);
}

/** 勾选 / 取消某个周期；至少保留一条，避免出现空图。 */
function toggle(h: Horizon) {
  const i = active.value.indexOf(h);
  if (i >= 0) {
    if (active.value.length === 1) return;
    active.value = active.value.filter((x) => x !== h);
  } else {
    active.value = [...active.value, h];
  }
  persistActive();
}

function setPreset(hs: Horizon[]) {
  active.value = [...hs];
  persistActive();
}

function rate(s: HorizonStat): string {
  if (!s.samples) return '—';
  return `${Math.round((s.win / s.samples) * 100)}%`;
}
function rateCls(s: HorizonStat): string {
  if (!s.samples) return 'muted';
  return s.win / s.samples >= 0.5 ? 'up' : 'down';
}
function sampleText(s: HorizonStat): string {
  return s.samples ? `${s.win}/${s.samples}` : '0/0';
}
/** 单格提示：样本数 + 均值，鼠标悬停可看，不占列宽。 */
function cellTitle(s: HorizonStat): string {
  if (!s.samples) return '无样本';
  return `样本 ${s.win}/${s.samples} · 均值 ${fmtPct(s.avg)} · 亏损 ${s.lose}`;
}

// 时间线折线（纯 SVG，无第三方依赖）：横轴为锚定日（旧 → 新），纵轴为平均收益 %。
const chart = computed(() => {
  const pts = stats.value?.timeline ?? [];
  if (pts.length < 2) return null;
  const shown = HORIZONS.filter((h) => active.value.includes(h));
  const vals = pts.flatMap((p) => shown.map((h) => timelineAvg(p, h))).filter((v): v is number => v != null);
  if (!vals.length) return null;

  const W = 680;
  const H = 200;
  const padL = 40;
  const padR = 12;
  const padT = 14;
  const padB = 24;

  let min = Math.min(0, ...vals);
  let max = Math.max(0, ...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.1;
  min -= pad;
  max += pad;

  const x = (i: number) => padL + (W - padL - padR) * (i / (pts.length - 1));
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - min) / (max - min));

  const showDots = pts.length <= 60;
  const series = shown.map((h) => ({
    h,
    color: H_COLOR[h],
    points: pts
      .map((p, i) => {
        const v = timelineAvg(p, h);
        return v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .filter((s): s is string => s !== null)
      .join(' '),
  }));
  const dots = showDots
    ? pts.flatMap((p, i) =>
        shown
          .map((h) => {
            const v = timelineAvg(p, h);
            return v == null ? null : { k: `${h}-${i}`, color: H_COLOR[h], cx: x(i), cy: y(v) };
          })
          .filter((d): d is { k: string; color: string; cx: number; cy: number } => d !== null),
      )
    : [];

  return {
    W,
    H,
    padL,
    padR,
    padT,
    padB,
    min,
    max,
    zeroY: y(0),
    series,
    dots,
    showDots,
    first: pts[0].anchor_date,
    last: pts[pts.length - 1].anchor_date,
  };
});

// 锚定日明细表：默认「锚定日倒序」（最新在上）；走势图仍按时间正序，便于看清「向右 = 更近」的趋势。
// 列头可点：锚定日 / 入选数 / N1…N10（该锚定日全部入选票在该周期的平均收益）。
type TimelineSortKey = 'anchor' | 'picks' | Horizon;
const {
  sortKey: tlSortKey,
  sortDir: tlSortDir,
  toggle: toggleTlSort,
  sortRows: sortTlRows,
} = useColumnSort<TimelineSortKey>({
  initialKey: 'anchor',
  initialDir: 'desc',
  numericKeys: ['picks', ...HORIZONS],
  dirFor: (k) => (k === 'anchor' ? 'desc' : undefined),
});

function tlSortValue(p: TimelinePoint, k: TimelineSortKey): SortValue {
  if (k === 'anchor') return p.anchor_date;
  if (k === 'picks') return p.picks;
  return timelineAvg(p, k);
}

const timelineRows = computed(() => sortTlRows(stats.value?.timeline ?? [], tlSortValue));

/** 列头箭头：仅当前排序列显示方向。 */
function tlArrow(k: TimelineSortKey): string {
  if (tlSortKey.value !== k) return '';
  return tlSortDir.value === 'desc' ? '▼' : '▲';
}

onMounted(load);
</script>

<template>
  <div class="stats">
    <PageHeader
      title="复盘统计"
      sub="入选后 N1 / N2 / N3 / N5 / N7 / N9 / N10 的命中率与平均收益（胜 = 收益 > 0）"
    >
      <template #actions>
        <router-link class="ghost-btn" to="/rules">规则释义 →</router-link>
      </template>
    </PageHeader>

    <!-- 区间过滤：默认最近一个月 -->
    <section class="filters">
      <span class="presets">
        <button
          v-for="p in RANGE_PRESETS"
          :key="p.key"
          class="chip"
          :class="{ active: preset === p.key }"
          @click="applyPreset(p)"
        >
          {{ p.label }}
        </button>
      </span>
      <label>起 <input type="date" v-model="from" @change="preset = 'custom'" /></label>
      <label>止 <input type="date" v-model="to" @change="preset = 'custom'" /></label>
      <button class="apply" @click="applyRange">应用</button>
      <span class="range-meta">{{ from || '不限' }} ~ {{ to || '不限' }}</span>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载统计…</p>

    <template v-else-if="stats">
      <!-- 总览 -->
      <section class="summary">
        <div class="card"><span class="k">运行批次</span><span class="v">{{ stats.total_runs }}</span></div>
        <div class="card"><span class="k">入选总数</span><span class="v">{{ stats.total_picks }}</span></div>
        <div class="card" v-for="h in HORIZONS" :key="h">
          <span class="k">{{ H_LABEL[h] }} 胜率</span>
          <span class="v" :class="rateCls(stats.overall[h])">{{ rate(stats.overall[h]) }}</span>
          <span class="s">{{ sampleText(stats.overall[h]) }} · 均 {{ fmtPct(stats.overall[h].avg) }}</span>
        </div>
      </section>

      <!-- 各档命中率：每个 N 只占一列（上行胜率 / 下行平均收益），避免 15 列过宽 -->
      <section class="block">
        <h2>各档命中率</h2>
        <p class="legend head">
          每格：<b>上行 = 胜率</b>（收益 &gt; 0 的占比），<b>下行 = 平均收益</b>（悬停可见样本数）；
          档位与指标口径见 <router-link to="/rules">规则释义</router-link>。
        </p>
        <div class="table-wrap">
          <table class="grid">
            <colgroup>
              <col style="width: 5%" />
              <col style="width: 10.5%" />
              <col style="width: 7.5%" />
              <col v-for="h in HORIZONS" :key="h" style="width: 11%" />
            </colgroup>
            <thead>
              <tr>
                <th class="ctr idx">序号</th>
                <th class="ctr">档位</th><th class="num">入选</th>
                <th v-for="h in HORIZONS" :key="h" class="num th-merged">
                  <span class="th1">{{ H_LABEL[h] }}</span>
                  <span class="th2">胜率 / 收益</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(t, i) in stats.tiers" :key="t.tier">
                <td class="ctr idx">{{ i + 1 }}</td>
                <td class="ctr"><TierBadge :tier="t.tier" /></td>
                <td class="num">{{ t.picks }}</td>
                <td v-for="h in HORIZONS" :key="h" class="num merged" :title="cellTitle(t[h])">
                  <span class="rate" :class="rateCls(t[h])">{{ rate(t[h]) }}</span>
                  <span class="gain" :class="perfClass(t[h].avg)">{{ fmtPct(t[h].avg) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 平均收益走势 -->
      <section class="block" v-if="stats.timeline.length">
        <h2>平均收益走势</h2>
        <div class="chart-bar">
          <span class="presets">
            <button class="chip" @click="setPreset(H_COMMON)">N1/N2/N3/N5</button>
            <button class="chip" @click="setPreset(H_SHORT)">N1–N3</button>
            <button class="chip" @click="setPreset(H_LONG)">N5–N10</button>
            <button class="chip" @click="setPreset(ALL_H)">全部</button>
          </span>
          <div class="legend-toggles">
            <button
              v-for="h in HORIZONS"
              :key="h"
              class="lg"
              :class="{ off: !isActive(h) }"
              :style="{ '--c': H_COLOR[h] }"
              :aria-pressed="isActive(h)"
              @click="toggle(h)"
            >
              {{ H_LABEL[h] }}
            </button>
          </div>
          <span class="tip">点图例可勾选 / 取消</span>
        </div>

        <svg v-if="chart" class="chart" :viewBox="`0 0 ${chart.W} ${chart.H}`" preserveAspectRatio="none">
          <line :x1="chart.padL" :x2="chart.W - chart.padR" :y1="chart.zeroY" :y2="chart.zeroY" class="zero" />
          <polyline
            v-for="s in chart.series"
            :key="s.h"
            :points="s.points"
            class="line"
            :style="{ stroke: s.color }"
          />
          <template v-if="chart.showDots">
            <circle v-for="d in chart.dots" :key="d.k" :cx="d.cx" :cy="d.cy" r="2.5" :style="{ fill: d.color }" />
          </template>
          <text :x="2" :y="chart.padT + 8" class="axis">{{ chart.max.toFixed(1) }}</text>
          <text :x="2" :y="chart.zeroY + 4" class="axis">0</text>
          <text :x="2" :y="chart.H - chart.padB" class="axis">{{ chart.min.toFixed(1) }}</text>
        </svg>
        <p v-else class="legend">该区间锚定日不足 2 个，暂不绘制走势；下方明细表仍可用。</p>
        <div class="chart-x" v-if="chart">
          <span>{{ chart.first }}（较早）</span>
          <span>{{ chart.last }}（最新）</span>
        </div>

        <!-- 明细：锚定日倒序 -->
        <div class="table-wrap timeline">
          <table class="grid">
            <colgroup>
              <col style="width: 5%" />
              <col style="width: 14.5%" />
              <col style="width: 7.5%" />
              <col v-for="h in HORIZONS" :key="h" style="width: 10.4%" />
            </colgroup>
            <thead>
              <tr>
                <th class="ctr idx">序号</th>
                <th class="ctr sortable" :class="{ sorted: tlSortKey === 'anchor' }">
                  <button class="th-btn" type="button" @click="toggleTlSort('anchor')">
                    <span>锚定日</span><span class="arrow">{{ tlArrow('anchor') }}</span>
                  </button>
                </th>
                <th class="num sortable" :class="{ sorted: tlSortKey === 'picks' }">
                  <button class="th-btn" type="button" @click="toggleTlSort('picks')">
                    <span>入选</span><span class="arrow">{{ tlArrow('picks') }}</span>
                  </button>
                </th>
                <th
                  v-for="h in HORIZONS"
                  :key="h"
                  class="num sortable"
                  :class="{ sorted: tlSortKey === h }"
                >
                  <button class="th-btn" type="button" @click="toggleTlSort(h)">
                    <span>{{ H_LABEL[h] }}</span><span class="arrow">{{ tlArrow(h) }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in timelineRows" :key="p.anchor_date">
                <td class="ctr idx">{{ i + 1 }}</td>
                <td class="mono ctr">{{ p.anchor_date }}</td>
                <td class="num">{{ p.picks }}</td>
                <td v-for="h in HORIZONS" :key="h" class="num" :class="perfClass(timelineAvg(p, h))">
                  {{ fmtPct(timelineAvg(p, h)) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="legend">
          明细默认按锚定日<b>倒序</b>；<b>点列头</b>可排序，空值恒排在最后。指标与排序口径见
          <router-link to="/rules">规则释义</router-link>。
        </p>
      </section>

      <p v-if="stats.total_picks === 0" class="hint">该区间暂无入选记录，可切换「近三月 / 全部」。</p>
    </template>
  </div>
</template>

<style scoped>
.stats { display: flex; flex-direction: column; gap: 16px; }

.filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.filters input[type='date'] {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 5px 8px; font: inherit;
}
.filters button {
  border-radius: 8px; padding: 6px 14px; cursor: pointer; font: inherit; font-size: 13px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
}
.filters .apply { border-color: var(--accent); color: var(--accent); background: rgba(31,111,235,0.12); }
.presets { display: inline-flex; gap: 6px; }
.chip {
  border-radius: 999px !important; padding: 5px 12px !important; font-size: 12px !important;
}
.chip.active { border-color: var(--accent); color: var(--accent); background: rgba(31,111,235,0.12); }
.range-meta { font-size: 12px; }

.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.card .k { font-size: 12px; color: var(--muted); }
.card .v { font-size: 20px; font-weight: 700; }
.card .s { font-size: 11px; color: var(--muted); }

.block h2 { font-size: 16px; margin: 0 0 12px; }
.table-wrap { overflow: hidden; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px; }
.grid th, .grid td { padding: 8px 8px; text-align: left; overflow-wrap: anywhere; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 序号列：按当前展示顺序编号（排序后跟着重排），只做定位参考 */
.grid .idx { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; white-space: nowrap; }
.grid th.ctr, .grid td.ctr { text-align: center; }
.grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; white-space: nowrap; }
.grid .desc { white-space: normal; color: var(--muted); line-height: 1.6; }

/* 合并列：上行胜率 + 下行平均收益（保持 table-cell，避免破坏列对齐） */
.th-merged { line-height: 1.25; }
.th1 { display: block; }
.th2 { display: block; font-size: 10px; font-weight: 400; color: var(--muted); opacity: 0.8; }
.merged .rate, .merged .gain { display: block; line-height: 1.3; }
.merged .rate { font-weight: 700; }
.merged .gain { font-size: 11px; }

.up { color: #ff7b72; }
.down { color: #3fb950; }
.flat { color: var(--muted); }
.muted { color: var(--muted); }
.legend { color: var(--muted); font-size: 12px; margin: 10px 0 0; line-height: 1.7; }
.legend a { color: var(--accent); text-decoration: none; }
.legend a:hover { text-decoration: underline; }
.legend.head { margin: 0 0 10px; background: rgba(31,111,235,0.08); border: 1px solid rgba(31,111,235,0.25); border-radius: 8px; padding: 8px 10px; }

.chart-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.legend-toggles { display: flex; gap: 10px; flex-wrap: wrap; }
.lg {
  display: inline-flex; align-items: center; gap: 6px; color: var(--text);
  background: none; border: none; cursor: pointer; font: inherit; font-size: 12px; padding: 2px 0;
}
.lg::before { content: ''; width: 14px; height: 2px; border-radius: 2px; background: var(--c); }
.lg.off { opacity: 0.35; text-decoration: line-through; }
.tip { font-size: 11px; color: var(--muted); }

.chart { width: 100%; height: 200px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
.chart .zero { stroke: var(--border); stroke-width: 1; stroke-dasharray: 4 4; }
.chart .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .axis { fill: var(--muted); font-size: 10px; }
.chart-x { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; margin-top: 4px; }
.timeline { margin-top: 14px; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
