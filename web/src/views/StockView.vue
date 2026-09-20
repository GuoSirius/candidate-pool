<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import type { StockHistory } from '../api/types';
import { fmtNum, fmtPct, perfClass } from '../utils/format';
import { HORIZONS, H_LABEL, HORIZON_NOTE_SHORT } from '../constants/glossary';
import TierBadge from '../components/TierBadge.vue';
import RuleTags from '../components/RuleTags.vue';

const route = useRoute();

const code = computed(() => String(route.params.code));
const data = ref<StockHistory | null>(null);
const loading = ref(false);
const error = ref<string>('');

async function load(code: string) {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.getStock(code);
  } catch (e) {
    data.value = null;
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

const base = computed(() => data.value?.base ?? null);
const picks = computed(() => data.value?.picks ?? []);

// 各周期复盘汇总：逐 N 统计有数据的样本数、平均、最佳、最差。
const perfSummary = computed(() =>
  HORIZONS.map((h) => {
    const vals = picks.value.map((p) => p.perf?.[h]).filter((v): v is number => typeof v === 'number');
    if (!vals.length) return { h, n: 0, avg: null as number | null, best: null as number | null, worst: null as number | null };
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { h, n: vals.length, avg, best: Math.max(...vals), worst: Math.min(...vals) };
  }),
);

watch(code, (c) => load(c), { immediate: false });

onMounted(() => load(code.value));
</script>

<template>
  <div class="stock">
    <header class="page-head">
      <div class="title">
        <router-link class="ghost-btn" to="/">← 候选列表</router-link>
        <h1>
          <span class="code">{{ code }}</span>
          <span class="name" v-if="base?.name">{{ base.name }}</span>
        </h1>
        <p class="sub" v-if="base?.sector">{{ base.sector }}<template v-if="base.region"> · {{ base.region }}</template></p>
      </div>
      <router-link class="ghost-btn" to="/rules">规则释义 →</router-link>
    </header>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载股票档案…</p>

    <template v-else-if="data">
      <!-- 基础档案 -->
      <section class="card" v-if="base">
        <h2>基础档案</h2>
        <div class="kv">
          <div v-if="base.concepts"><span class="k">题材</span><span class="v">{{ base.concepts }}</span></div>
          <div v-if="base.main_business"><span class="k">主营</span><span class="v">{{ base.main_business }}</span></div>
          <div v-if="base.top_business"><span class="k">最赚钱业务</span><span class="v">{{ base.top_business }}</span></div>
        </div>
        <div class="groups" v-if="data.groups.length">
          <span class="gl">分组：</span>
          <span
            v-for="g in data.groups"
            :key="g.id"
            class="gchip"
            :style="{ color: g.color || '#8b949e', borderColor: g.color || '#30363d' }"
          >{{ g.name }}</span>
        </div>
      </section>

      <!-- 备注 -->
      <section class="card" v-if="data.notes.length">
        <h2>备注 / 备忘</h2>
        <ul class="notes">
          <li v-for="n in data.notes" :key="n.id">
            <span class="ntype">{{ n.type === 'memo' ? '备忘' : '评论' }}</span>
            <span class="ncontent">{{ n.content }}</span>
            <span class="nmeta" v-if="n.anchor_date">{{ n.anchor_date }}</span>
          </li>
        </ul>
      </section>

      <!-- 各周期复盘汇总 -->
      <section class="card" v-if="picks.length">
        <h2>入选后各周期表现（复盘）</h2>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>周期</th><th class="num">样本</th><th class="num">平均</th>
                <th class="num">最佳</th><th class="num">最差</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in perfSummary" :key="s.h">
                <td class="mono">{{ H_LABEL[s.h] }}</td>
                <td class="num">{{ s.n || '—' }}</td>
                <td class="num" :class="perfClass(s.avg)">{{ fmtPct(s.avg) }}</td>
                <td class="num" :class="perfClass(s.best)">{{ fmtPct(s.best) }}</td>
                <td class="num" :class="perfClass(s.worst)">{{ fmtPct(s.worst) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="legend">逐周期统计该票历史入选记录的表现，仅计入有数据的样本；距锚定日过近时后段周期暂缺（显示 —）。</p>
      </section>

      <!-- 各期入选与 N 日收益 -->
      <section class="card">
        <h2>入选记录（共 {{ picks.length }} 期）</h2>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>锚定日</th><th>档位</th><th>规则</th><th class="num">入选价</th>
                <th v-for="h in HORIZONS" :key="h" class="num">{{ H_LABEL[h] }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in picks" :key="p.id">
                <td class="mono">{{ p.anchor_date }}</td>
                <td><TierBadge :tier="p.tier" /></td>
                <td><RuleTags :pick="p" /></td>
                <td class="num">{{ fmtNum(p.price) }}</td>
                <td v-for="h in HORIZONS" :key="h" class="num" :class="perfClass(p.perf?.[h])">
                  {{ fmtPct(p.perf?.[h]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="legend">
          {{ HORIZON_NOTE_SHORT }}涨 = 红，跌 = 绿；数据缺失显示 —。档位（重点 / 次级 / 条件 / 排除）与 R01 / R07 / R05 标签含义见
          <router-link to="/rules">规则释义</router-link>。
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.stock { display: flex; flex-direction: column; gap: 16px; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-head .title { display: flex; flex-direction: column; gap: 6px; }
.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; width: fit-content; white-space: nowrap; }
.ghost-btn:hover { text-decoration: underline; }
.page-head h1 { font-size: 22px; margin: 0; display: flex; align-items: baseline; gap: 10px; }
.page-head .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent); }
.page-head .name { font-size: 18px; }
.sub { color: var(--muted); margin: 0; font-size: 13px; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.card h2 { font-size: 15px; margin: 0 0 12px; }
.kv { display: flex; flex-direction: column; gap: 8px; }
.kv > div { display: flex; gap: 10px; font-size: 13px; }
.kv .k { color: var(--muted); min-width: 84px; }
.kv .v { line-height: 1.6; }

.groups { margin-top: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gl { color: var(--muted); font-size: 13px; }
.gchip { border: 1px solid; border-radius: 999px; padding: 2px 10px; font-size: 12px; }

.notes { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.notes li { display: flex; gap: 10px; align-items: baseline; font-size: 13px; flex-wrap: wrap; }
.ntype { color: var(--accent); font-weight: 600; font-size: 12px; }
.ncontent { line-height: 1.6; }
.nmeta { color: var(--muted); font-size: 12px; margin-left: auto; }

.stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
.stat { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.stat .k { font-size: 12px; color: var(--muted); }
.stat .v { font-size: 18px; font-weight: 700; }

.table-wrap { overflow: hidden; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 8px; text-align: left; overflow-wrap: anywhere; }
.grid thead th { color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); line-height: 1.3; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 12px; }
.grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; white-space: nowrap; }
.grid :deep(.rule-tags) { gap: 2px; }
.grid :deep(.rule-tag) { padding: 0 4px; font-size: 10px; }
.up { color: #ff7b72; }
.down { color: #3fb950; }
.flat { color: var(--muted); }
.legend { color: var(--muted); font-size: 12px; margin: 10px 0 0; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
