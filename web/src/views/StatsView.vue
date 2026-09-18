<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, ApiError } from '../api/client';
import type { StatsResult, HorizonStat, TimelinePoint } from '../api/types';
import { fmtPct, perfClass } from '../utils/format';
import TierBadge from '../components/TierBadge.vue';

const stats = ref<StatsResult | null>(null);
const loading = ref(false);
const error = ref<string>('');
const from = ref('');
const to = ref('');

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

const horizons = ['n1', 'n3', 'n5', 'n10'] as const;
type Horizon = (typeof horizons)[number];
const H_LABEL: Record<Horizon, string> = { n1: 'N1', n3: 'N3', n5: 'N5', n10: 'N10' };

// 时间线折线（纯 SVG，无第三方依赖）：横轴为锚定日序号，纵轴为平均收益 %。
const chart = computed(() => {
  const pts = stats.value?.timeline ?? [];
  if (pts.length < 2) return null;
  const vals = pts.flatMap((p) => [p.n5_avg, p.n10_avg]).filter((v): v is number => v != null);
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
  const line = (sel: (p: TimelinePoint) => number | null) =>
    pts
      .map((p, i) => {
        const v = sel(p);
        return v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .filter((s): s is string => s !== null)
      .join(' ');

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
    n5: line((p) => p.n5_avg),
    n10: line((p) => p.n10_avg),
    first: pts[0].anchor_date,
    last: pts[pts.length - 1].anchor_date,
  };
});

onMounted(load);
</script>

<template>
  <div class="stats">
    <header class="page-head">
      <div>
        <h1>复盘统计</h1>
        <p class="sub">入选后 N1 / N3 / N5 / N10 的命中率与平均收益（胜 = 收益 &gt; 0）</p>
      </div>
    </header>

    <!-- 区间过滤 -->
    <section class="filters">
      <label>起 <input type="date" v-model="from" /></label>
      <label>止 <input type="date" v-model="to" /></label>
      <button class="apply" @click="load">应用</button>
      <button class="reset" @click="((from = ''), (to = ''), load())">全部</button>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载统计…</p>

    <template v-else-if="stats">
      <!-- 总览 -->
      <section class="summary">
        <div class="card"><span class="k">运行批次</span><span class="v">{{ stats.total_runs }}</span></div>
        <div class="card"><span class="k">入选总数</span><span class="v">{{ stats.total_picks }}</span></div>
        <div class="card" v-for="h in horizons" :key="h">
          <span class="k">{{ H_LABEL[h] }} 胜率</span>
          <span class="v" :class="rateCls(stats.overall[h])">{{ rate(stats.overall[h]) }}</span>
          <span class="s">{{ sampleText(stats.overall[h]) }} · 均 {{ fmtPct(stats.overall[h].avg) }}</span>
        </div>
      </section>

      <!-- 各档命中率 -->
      <section class="block">
        <h2>各档命中率</h2>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>档位</th><th class="num">入选</th>
                <th v-for="h in horizons" :key="h" class="num">{{ H_LABEL[h] }} 胜率</th>
                <th v-for="h in horizons" :key="h + 'a'" class="num">{{ H_LABEL[h] }} 均值</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in stats.tiers" :key="t.tier">
                <td><TierBadge :tier="t.tier" /></td>
                <td class="num">{{ t.picks }}</td>
                <td v-for="h in horizons" :key="h" class="num" :class="rateCls(t[h])">
                  {{ rate(t[h]) }}
                </td>
                <td v-for="h in horizons" :key="h + 'a'" class="num" :class="perfClass(t[h].avg)">
                  {{ fmtPct(t[h].avg) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="legend">胜率 = 收益 &gt; 0 的样本占比；均值仅统计有数据的样本。</p>
      </section>

      <!-- 时间线 -->
      <section class="block" v-if="chart">
        <h2>平均收益走势</h2>
        <div class="chart-legend">
          <span class="lg n5">N5 均值</span>
          <span class="lg n10">N10 均值</span>
        </div>
        <svg class="chart" :viewBox="`0 0 ${chart.W} ${chart.H}`" preserveAspectRatio="none">
          <line :x1="chart.padL" :x2="chart.W - chart.padR" :y1="chart.zeroY" :y2="chart.zeroY" class="zero" />
          <polyline :points="chart.n5" class="s-n5" />
          <polyline :points="chart.n10" class="s-n10" />
          <text :x="2" :y="chart.padT + 8" class="axis">{{ chart.max.toFixed(1) }}</text>
          <text :x="2" :y="chart.zeroY + 4" class="axis">0</text>
          <text :x="2" :y="chart.H - chart.padB" class="axis">{{ chart.min.toFixed(1) }}</text>
        </svg>
        <div class="chart-x">
          <span>{{ chart.first }}</span>
          <span>{{ chart.last }}</span>
        </div>

        <div class="table-wrap timeline">
          <table class="grid">
            <thead>
              <tr><th>锚定日</th><th class="num">入选</th><th class="num">N1 均值</th><th class="num">N5 均值</th><th class="num">N10 均值</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in stats.timeline" :key="p.anchor_date">
                <td class="mono">{{ p.anchor_date }}</td>
                <td class="num">{{ p.picks }}</td>
                <td class="num" :class="perfClass(p.n1_avg)">{{ fmtPct(p.n1_avg) }}</td>
                <td class="num" :class="perfClass(p.n5_avg)">{{ fmtPct(p.n5_avg) }}</td>
                <td class="num" :class="perfClass(p.n10_avg)">{{ fmtPct(p.n10_avg) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p v-if="stats.total_picks === 0" class="hint">该区间暂无入选记录。</p>
    </template>
  </div>
</template>

<style scoped>
.stats { display: flex; flex-direction: column; gap: 16px; }
.page-head h1 { font-size: 22px; margin: 0; }
.sub { color: var(--muted); margin: 4px 0 0; font-size: 13px; }

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

.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.card .k { font-size: 12px; color: var(--muted); }
.card .v { font-size: 20px; font-weight: 700; }
.card .s { font-size: 11px; color: var(--muted); }

.block h2 { font-size: 16px; margin: 0 0 12px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.grid th, .grid td { padding: 9px 12px; text-align: left; white-space: nowrap; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; }
.grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; }
.up { color: #ff7b72; }
.down { color: #3fb950; }
.muted { color: var(--muted); }
.legend { color: var(--muted); font-size: 12px; margin: 10px 0 0; }

.chart-legend { display: flex; gap: 16px; font-size: 12px; margin-bottom: 6px; }
.lg { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
.lg::before { content: ''; width: 14px; height: 2px; border-radius: 2px; }
.lg.n5::before { background: #e3b341; }
.lg.n10::before { background: #79c0ff; }
.chart { width: 100%; height: 200px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
.chart .zero { stroke: var(--border); stroke-width: 1; stroke-dasharray: 4 4; }
.chart .s-n5 { fill: none; stroke: #e3b341; stroke-width: 2; }
.chart .s-n10 { fill: none; stroke: #79c0ff; stroke-width: 2; }
.chart .axis { fill: var(--muted); font-size: 10px; }
.chart-x { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; margin-top: 4px; }
.timeline { margin-top: 14px; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
