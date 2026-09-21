<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, ApiError } from '../api/client';
import type { TailRun, TailDiffResult, TailDiffRow } from '../api/types';
import { fmtNum, fmtPct, perfClass } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';

const runs = ref<TailRun[]>([]);
const selectedDate = ref('');
const result = ref<TailDiffResult | null>(null);
const loading = ref(false);
const error = ref('');

type NKey = 'n1' | 'n2' | 'n3' | 'n5' | 'n7' | 'n9' | 'n10';
const N_KEYS: NKey[] = ['n1', 'n2', 'n3', 'n5', 'n7', 'n9', 'n10'];
function nLabel(k: NKey): string { return 'N' + k.slice(1); }
function perfOf(p: TailDiffRow, k: NKey): number | null {
  return p.perf ? p.perf[k] : null;
}

/** 有任一口径的交易日（倒序），作为可选日期。 */
const dates = computed(() => {
  const set = new Set(runs.value.map((r) => r.trade_date));
  return [...set].sort((a, b) => (a < b ? 1 : -1));
});

const summary = computed(() => {
  const d = result.value?.diff ?? [];
  const both = d.filter((x) => x.inObserve && x.inFormal);
  const onlyObserve = d.filter((x) => x.inObserve && !x.inFormal);
  const onlyFormal = d.filter((x) => !x.inObserve && x.inFormal);
  const deltas = both.map((x) => x.totalDelta).filter((v): v is number => v != null);
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  return { both: both.length, onlyObserve: onlyObserve.length, onlyFormal: onlyFormal.length, avgDelta };
});

async function loadRuns() {
  error.value = '';
  try {
    runs.value = await api.getTailRuns(100);
    if (!dates.value.length) return;
    // 默认选中「同时有两种口径」的最新交易日，否则最新
    const both = runs.value
      .filter((r) => r.mode === 'formal')
      .map((r) => r.trade_date)
      .filter((d) => runs.value.some((r) => r.trade_date === d && r.mode === 'observe'));
    selectedDate.value = both[0] ?? dates.value[0];
    await loadDiff();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  }
}

async function loadDiff() {
  if (!selectedDate.value) return;
  loading.value = true;
  error.value = '';
  try {
    result.value = await api.getTailDiff(selectedDate.value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    result.value = null;
  } finally {
    loading.value = false;
  }
}

function onDateChange() {
  loadDiff();
}

onMounted(loadRuns);
</script>

<template>
  <div class="tdiff">
    <PageHeader title="口径对照" sub="同一交易日：盘中观察口径 vs 收盘固定口径的候选差异">
      <template #actions>
        <router-link class="ghost-btn" to="/tail/review">尾盘复盘 →</router-link>
      </template>
    </PageHeader>

    <section class="controls" v-if="dates.length">
      <label class="date-sel">
        <span class="lbl">交易日</span>
        <select v-model="selectedDate" @change="onDateChange">
          <option v-for="d in dates" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!dates.length" class="hint">暂无尾盘运行数据，无法对照。</p>

    <section class="summary" v-else-if="summary">
      <div class="card"><span class="k">两端共有</span><span class="v">{{ fmtNum(summary.both, 0) }}</span></div>
      <div class="card"><span class="k">仅观察</span><span class="v">{{ fmtNum(summary.onlyObserve, 0) }}</span></div>
      <div class="card"><span class="k">仅正式</span><span class="v">{{ fmtNum(summary.onlyFormal, 0) }}</span></div>
      <div class="card"><span class="k">共有者均分差</span><span class="v" :class="perfClass(summary.avgDelta)">{{ fmtNum(summary.avgDelta) }}</span></div>
    </section>

    <p class="legend" v-if="result">
      总分差 = 固定口径总分 − 观察口径总分（仅两端都入选者有效）；正 = 临近收盘分数更高。复盘红涨绿跌，N 列仅七个检查点。
    </p>

    <section class="table-wrap" v-if="result && result.diff.length">
      <table class="grid">
        <colgroup>
          <col style="width: 7%" />
          <col style="width: 8%" />
          <col style="width: 9%" />
          <col style="width: 7%" />
          <col style="width: 7%" />
          <col style="width: 9%" />
          <col style="width: 9%" />
          <col style="width: 9%" />
          <col style="width: 35%" />
        </colgroup>
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>板块</th>
            <th class="ctr">观察</th>
            <th class="ctr">正式</th>
            <th class="num">观察总分</th>
            <th class="num">正式总分</th>
            <th class="num">分差</th>
            <th>复盘 N1~N10（优先正式）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in result.diff" :key="d.code">
            <td class="code">{{ d.code }}</td>
            <td class="name">{{ d.name ?? '—' }}</td>
            <td class="sector">{{ d.sector ?? '—' }}</td>
            <td class="ctr" data-label="观察">
              <span class="tag" :class="d.inObserve ? 'yes' : 'no'">{{ d.inObserve ? '✓' : '—' }}</span>
            </td>
            <td class="ctr" data-label="正式">
              <span class="tag" :class="d.inFormal ? 'yes' : 'no'">{{ d.inFormal ? '✓' : '—' }}</span>
            </td>
            <td class="num">{{ fmtNum(d.observeTotal) }}</td>
            <td class="num">{{ fmtNum(d.formalTotal) }}</td>
            <td class="num" :class="perfClass(d.totalDelta)">{{ fmtNum(d.totalDelta) }}</td>
            <td class="ncols">
              <span
                v-for="k in N_KEYS"
                :key="k"
                class="nchip"
                :class="perfClass(perfOf(d, k))"
              >{{ nLabel(k) }} {{ fmtPct(perfOf(d, k)) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-else-if="!error && !loading" class="hint">该交易日暂无对照数据。</p>
  </div>
</template>

<style scoped>
.tdiff { display: flex; flex-direction: column; gap: 16px; }
.controls { display: flex; align-items: center; }
.date-sel { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
.date-sel .lbl { font-weight: 600; color: var(--text); }
.date-sel select {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 10px; padding: 7px 12px; font: inherit; font-size: 13px; min-width: 180px; cursor: pointer;
}
.date-sel select:focus { outline: none; border-color: var(--accent); }

.summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.card .k { font-size: 12px; color: var(--muted); }
.card .v { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }

.legend { color: var(--muted); font-size: 12px; line-height: 1.75; margin: 0; }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 7px; text-align: left; overflow-wrap: anywhere; vertical-align: top; white-space: nowrap; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; }
.grid .ctr { text-align: center; }
.grid .code { font-weight: 600; color: var(--accent); }
.grid .name { white-space: nowrap; }
.grid .sector { color: var(--muted); }
.tag { font-size: 12px; font-weight: 700; }
.tag.yes { color: #3fb950; }
.tag.no { color: var(--muted); }
.up { color: #ff7b72; }
.down { color: #3fb950; }
.flat { color: var(--text); }
.ncols { display: flex; flex-wrap: wrap; gap: 3px; }
.nchip { font-size: 10.5px; padding: 1px 4px; border-radius: 5px; background: var(--bg); font-variant-numeric: tabular-nums; white-space: nowrap; }

.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; }
.ghost-btn:hover { text-decoration: underline; }
.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
