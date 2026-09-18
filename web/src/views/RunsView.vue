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

watch(selectedAnchor, (a) => {
  if (a) loadRun(a);
});

onMounted(async () => {
  await loadRuns();
  if (selectedAnchor.value) await loadRun(selectedAnchor.value);
});
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

    <!-- 档位过滤 -->
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
    </section>

    <!-- 入选列表 -->
    <section class="table-wrap" v-if="!loading && filteredPicks.length">
      <table class="grid">
        <thead>
          <tr>
            <th>代码</th><th>名称</th><th>档位</th><th>规则</th><th>板块</th>
            <th class="num">价格</th><th class="num">R01涨跌</th><th class="num">换手率</th>
            <th class="num">流通市值</th><th class="num">板块强度</th><th>入选理由</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filteredPicks" :key="p.id" @click="openStock(p.code)">
            <td class="code">{{ p.code }}</td>
            <td class="name">{{ p.name ?? '—' }}</td>
            <td><TierBadge :tier="p.tier" /></td>
            <td><RuleTags :pick="p" /></td>
            <td class="sector">{{ p.sector ?? '—' }}</td>
            <td class="num">{{ fmtNum(p.price) }}</td>
            <td class="num" :class="p.r01_chg !== null && p.r01_chg > 0 ? 'up' : p.r01_chg !== null && p.r01_chg < 0 ? 'down' : ''">{{ fmtPct(p.r01_chg) }}</td>
            <td class="num">{{ fmtPct(p.turnover) }}</td>
            <td class="num">{{ fmtCap(p.circ_market_cap) }}</td>
            <td class="num">{{ fmtPct(p.sector_pct) }}</td>
            <td class="reason">{{ p.reason ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-else-if="loading" class="hint">加载入选列表…</p>
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

.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filter-btn {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 999px; padding: 6px 14px; cursor: pointer; font: inherit; font-size: 13px;
}
.filter-btn.active { border-color: var(--accent); background: rgba(31,111,235,0.12); color: var(--accent); }
.filter-btn .cnt { margin-left: 6px; font-size: 11px; color: var(--muted); }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.grid th, .grid td { padding: 9px 12px; text-align: left; white-space: nowrap; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; position: sticky; top: 0; }
.grid tbody tr { border-top: 1px solid var(--border); cursor: pointer; }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; }
.grid .code { font-weight: 600; color: var(--accent); }
.grid .name { font-weight: 500; }
.grid .sector, .grid .reason { color: var(--muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.grid .reason { white-space: normal; }
.up { color: #ff7b72; }
.down { color: #3fb950; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
