<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/client';
import type { TailRun } from '../api/types';
import { fmtNum, tailModeLabel } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';

const router = useRouter();
const runs = ref<TailRun[]>([]);
const loading = ref(false);
const error = ref('');

/** 组合（日期+口径）去重排序：日期倒序，同日内正式在前。 */
const rows = computed(() =>
  [...runs.value].sort((a, b) =>
    a.trade_date === b.trade_date
      ? (b.mode === 'formal' ? 1 : 0) - (a.mode === 'formal' ? 1 : 0)
      : a.trade_date < b.trade_date ? 1 : -1,
  ),
);

function open(run: TailRun) {
  router.push({ path: '/tail', query: { date: run.trade_date, mode: run.mode } });
}

onMounted(async () => {
  loading.value = true;
  error.value = '';
  try {
    runs.value = await api.getTailRuns(100);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="thist">
    <PageHeader title="尾盘记录" sub="按交易日 + 口径列出所有尾盘运行批次">
      <template #actions>
        <router-link class="ghost-btn" to="/tail">尾盘候选 →</router-link>
      </template>
    </PageHeader>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载运行记录…</p>
    <p v-else-if="!rows.length" class="hint">暂无尾盘运行记录。</p>

    <section class="table-wrap" v-else>
      <table class="grid">
        <colgroup>
          <col style="width: 16%" />
          <col style="width: 10%" />
          <col style="width: 10%" />
          <col style="width: 10%" />
          <col style="width: 13%" />
          <col style="width: 13%" />
          <col style="width: 12%" />
          <col style="width: 16%" />
        </colgroup>
        <thead>
          <tr>
            <th>交易日</th>
            <th class="ctr">口径</th>
            <th class="num">候选</th>
            <th class="num">行业组</th>
            <th class="num">初筛通过</th>
            <th class="num">快照</th>
            <th class="num">运行次数</th>
            <th class="num">截点</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="`${r.trade_date}|${r.mode}`" @click="open(r)">
            <td class="date" data-label="交易日">{{ r.trade_date }}</td>
            <td class="ctr" data-label="口径">
              <span class="mode" :class="r.mode">{{ tailModeLabel(r.mode) }}</span>
            </td>
            <td class="num" data-label="候选">{{ fmtNum(r.candidate_count, 0) }}</td>
            <td class="num" data-label="行业组">{{ fmtNum(r.group_count, 0) }}</td>
            <td class="num" data-label="初筛通过">{{ fmtNum(r.pre_pass_count, 0) }}</td>
            <td class="num" data-label="快照">{{ fmtNum(r.snapshot_count, 0) }}</td>
            <td class="num" data-label="运行次数">{{ r.runs?.length ?? 0 }}</td>
            <td class="num" data-label="截点">{{ r.cut_at ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.thist { display: flex; flex-direction: column; gap: 16px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 7px; text-align: left; white-space: nowrap; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; }
.grid tbody tr { border-top: 1px solid var(--border); cursor: pointer; }
.grid tbody tr:hover { background: rgba(31,111,235,0.06); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; }
.grid .ctr { text-align: center; }
.grid .date { font-weight: 600; font-variant-numeric: tabular-nums; }
.mode { font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.mode.formal { background: rgba(255,123,114,0.15); color: #ff7b72; }
.mode.observe { background: rgba(121,192,255,0.15); color: #79c0ff; }

.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; }
.ghost-btn:hover { text-decoration: underline; }
.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }

/* 窄屏：记录表翻转成紧凑卡片（行少列多，按 3 格一行排布） */
@media (max-width: 820px) {
  .table-wrap { border: none; border-radius: 0; }
  .grid, .grid tbody { display: block; width: 100%; }
  .grid thead { display: none; }
  .grid tr {
    display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px 4px; align-items: end;
    width: 100%; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px;
    padding: 12px; background: var(--surface);
  }
  .grid tbody tr:hover { background: var(--surface); }
  .grid td { display: flex; flex-direction: column; gap: 2px; padding: 0; border: none; white-space: normal; }
  .grid td::before { content: attr(data-label); color: var(--muted); font-size: 11px; font-weight: 600; }
  .grid td.num, .grid td.ctr { text-align: left; }
  .grid td.date { grid-column: 1 / 4; font-size: 14px; }
  .grid td.ctr { grid-column: 4 / 7; align-items: flex-start; }
  .grid td.num { grid-column: span 2; }
}
</style>
