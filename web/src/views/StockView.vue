<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import type { StockHistory } from '../api/types';
import { fmtNum, fmtPct, perfClass } from '../utils/format';
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

// N10 汇总：已平仓（数据完整）的样本均值与极值。
const n10Stats = computed(() => {
  const vals = picks.value.map((p) => p.perf?.n10).filter((v): v is number => v !== null && v !== undefined);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { avg, best: Math.max(...vals), worst: Math.min(...vals), n: vals.length };
});

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

      <!-- N10 复盘汇总 -->
      <section class="card" v-if="n10Stats">
        <h2>入选后 10 日表现（复盘）</h2>
        <div class="stat-row">
          <div class="stat"><span class="k">样本数</span><span class="v">{{ n10Stats.n }}</span></div>
          <div class="stat"><span class="k">平均</span><span class="v" :class="perfClass(n10Stats.avg)">{{ fmtPct(n10Stats.avg) }}</span></div>
          <div class="stat"><span class="k">最佳</span><span class="v" :class="perfClass(n10Stats.best)">{{ fmtPct(n10Stats.best) }}</span></div>
          <div class="stat"><span class="k">最差</span><span class="v" :class="perfClass(n10Stats.worst)">{{ fmtPct(n10Stats.worst) }}</span></div>
        </div>
      </section>

      <!-- 各期入选与 N 日收益 -->
      <section class="card">
        <h2>入选记录（共 {{ picks.length }} 期）</h2>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>锚定日</th><th>档位</th><th>规则</th><th class="num">入选价</th>
                <th class="num">N1</th><th class="num">N3</th><th class="num">N5</th><th class="num">N10</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in picks" :key="p.id">
                <td class="mono">{{ p.anchor_date }}</td>
                <td><TierBadge :tier="p.tier" /></td>
                <td><RuleTags :pick="p" /></td>
                <td class="num">{{ fmtNum(p.price) }}</td>
                <td class="num" :class="perfClass(p.perf?.n1)">{{ fmtPct(p.perf?.n1) }}</td>
                <td class="num" :class="perfClass(p.perf?.n3)">{{ fmtPct(p.perf?.n3) }}</td>
                <td class="num" :class="perfClass(p.perf?.n5)">{{ fmtPct(p.perf?.n5) }}</td>
                <td class="num" :class="perfClass(p.perf?.n10)">{{ fmtPct(p.perf?.n10) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="legend">涨 = 红，跌 = 绿。收益相对锚定日收盘价计算，数据缺失显示 —。</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.stock { display: flex; flex-direction: column; gap: 16px; }
.page-head .title { display: flex; flex-direction: column; gap: 6px; }
.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; width: fit-content; }
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

.table-wrap { overflow-x: auto; }
.grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.grid th, .grid td { padding: 9px 12px; text-align: left; white-space: nowrap; }
.grid thead th { color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
.grid th:first-child, .grid td:first-child { position: sticky; left: 0; background: var(--bg); z-index: 1; }
.grid thead th:first-child { z-index: 2; background: var(--surface); }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; }
.grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; }
.up { color: #ff7b72; }
.down { color: #3fb950; }
.legend { color: var(--muted); font-size: 12px; margin: 10px 0 0; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
