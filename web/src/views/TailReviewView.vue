<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api, ApiError } from '../api/client';
import type { TailReviewResult, TailReviewSummary, TailPickRow, TailMode } from '../api/types';
import { fmtNum, fmtPct, perfClass } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';

const mode = ref<TailMode>('formal');
const from = ref('');
const to = ref('');
const result = ref<TailReviewResult | null>(null);
const loading = ref(false);
const error = ref('');

type NKey = 'n1' | 'n2' | 'n3' | 'n5' | 'n7' | 'n9' | 'n10';
const N_KEYS: NKey[] = ['n1', 'n2', 'n3', 'n5', 'n7', 'n9', 'n10'];

function nLabel(k: NKey): string {
  return 'N' + k.slice(1);
}

const summary = computed<TailReviewSummary | null>(() => result.value?.summary ?? null);

/** 命中率 = 盈利样本 / 有效样本；其余口径（平/缺）不计入胜率分母。 */
function winRate(s: TailReviewSummary, k: NKey): number | null {
  const hs = s[k];
  if (!hs.samples) return null;
  return (hs.win / hs.samples) * 100;
}

function perfOf(p: TailPickRow, k: NKey): number | null {
  return p.perf ? p.perf[k] : null;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    result.value = await api.getTailReview(from.value || null, to.value || null, mode.value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    result.value = null;
  } finally {
    loading.value = false;
  }
}

watch([mode, from, to], () => load());

onMounted(load);
</script>

<template>
  <div class="treview">
    <PageHeader title="尾盘复盘" sub="区间内尾盘候选的 N1~N10 收益表现（红涨绿跌）">
      <template #actions>
        <router-link class="ghost-btn" to="/tail/diff">口径对照 →</router-link>
      </template>
    </PageHeader>

    <!-- 口径 + 区间 -->
    <section class="controls">
      <div class="mode-switch">
        <button :class="{ active: mode === 'formal' }" @click="mode = 'formal'">正式口径</button>
        <button :class="{ active: mode === 'observe' }" @click="mode = 'observe'">观察口径</button>
      </div>
      <label class="date-in"><span>起</span><input type="date" v-model="from" /></label>
      <label class="date-in"><span>止</span><input type="date" v-model="to" /></label>
      <span class="range-meta" v-if="result">
        区间 {{ result.range.from ?? '最早' }} ~ {{ result.range.to ?? '最新' }} · {{ result.rows.length }} 条候选
      </span>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载复盘数据…</p>

    <!-- 汇总：各周期命中率 / 均值 -->
    <section class="summary" v-if="summary">
      <div class="scard" v-for="k in N_KEYS" :key="k">
        <div class="sk">{{ nLabel(k) }}</div>
        <div class="savg" :class="perfClass(summary[k].avg)">
          {{ fmtPct(summary[k].avg) }}
        </div>
        <div class="srate">
          <span class="up">胜 {{ ((winRate(summary, k) ?? 0)).toFixed(0) }}%</span>
          <span class="muted">/ {{ summary[k].samples }} 样本</span>
        </div>
      </div>
    </section>

    <p class="legend" v-if="result">
      胜率 = 盈利样本数 / 有效样本数（平/缺不计入分母）；均值 = 有效样本 N 周期收益算术平均。N 列仅 N1/N2/N3/N5/N7/N9/N10 七个检查点。
    </p>

    <!-- 明细（宽表：11 逻辑列 → 移动端横向滚动） -->
    <section class="table-wrap" v-if="result && result.rows.length">
      <table class="grid">
        <colgroup>
          <col style="width: 4%" />
          <col style="width: 7%" />
          <col style="width: 8%" />
          <col style="width: 8%" />
          <col style="width: 8%" />
          <col style="width: 11%" />
          <col style="width: 54%" />
        </colgroup>
        <thead>
          <tr>
            <th class="ctr">序号</th>
            <th>代码</th>
            <th>名称</th>
            <th>板块</th>
            <th>交易日</th>
            <th>总分</th>
            <th>复盘 N1~N10</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in result.rows" :key="`${p.trade_date}|${p.code}`">
            <td class="ctr idx">{{ i + 1 }}</td>
            <td class="code">{{ p.code }}</td>
            <td class="name">{{ p.name ?? '—' }}</td>
            <td class="sector">{{ p.sector ?? '—' }}</td>
            <td class="date">{{ p.trade_date }}</td>
            <td class="num total">{{ fmtNum(p.total) }}</td>
            <td class="ncols">
              <span
                v-for="k in N_KEYS"
                :key="k"
                class="nchip"
                :class="perfClass(perfOf(p, k))"
              >{{ nLabel(k) }} {{ fmtPct(perfOf(p, k)) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-else-if="!error && !loading" class="hint">该区间暂无复盘数据。</p>
  </div>
</template>

<style scoped>
.treview { display: flex; flex-direction: column; gap: 16px; }
.controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.mode-switch { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
.mode-switch button {
  background: var(--surface); border: none; color: var(--text); padding: 6px 16px;
  cursor: pointer; font: inherit; font-size: 13px;
}
.mode-switch button.active { background: var(--accent); color: #fff; }
.date-in { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.date-in input {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 13px;
}
.date-in input:focus { outline: none; border-color: var(--accent); }
.range-meta { font-size: 12px; color: var(--muted); }

.summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: 10px; }
.scard { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.scard .sk { font-size: 12px; color: var(--muted); font-weight: 600; }
.scard .savg { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.scard .srate { font-size: 11.5px; font-variant-numeric: tabular-nums; }
.scard .srate .up { color: #ff7b72; font-weight: 600; }
.muted { color: var(--muted); }
.up { color: #ff7b72; }
.down { color: #3fb950; }
.flat { color: var(--text); }

.legend { color: var(--muted); font-size: 12px; line-height: 1.75; margin: 0; }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 7px; text-align: left; overflow-wrap: anywhere; vertical-align: top; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; white-space: nowrap; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .idx { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11.5px; white-space: nowrap; text-align: center; }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.grid .code { white-space: nowrap; font-weight: 600; color: var(--accent); }
.grid .name { white-space: nowrap; }
.grid .sector, .grid .date { color: var(--muted); white-space: nowrap; }
.grid .total { font-weight: 700; }
.ncols { display: flex; flex-wrap: wrap; gap: 3px; }
.nchip { font-size: 10.5px; padding: 1px 4px; border-radius: 5px; background: var(--bg); font-variant-numeric: tabular-nums; white-space: nowrap; }

.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; }
.ghost-btn:hover { text-decoration: underline; }
.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
