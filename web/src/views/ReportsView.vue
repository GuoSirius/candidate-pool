<script setup lang="ts">
/*
 * 报告查看页（盘后 / 盘中共用一个组件，kind 区分）。
 *
 * 报告 HTML 本体托管在 GitHub Pages（与站点不同源），这里只做两件事：
 *   1. 从 Worker 接口拿「有哪些报告」（盘后 = runs 的 anchor_date；盘中 = tail runs 的日期+口径）；
 *   2. 映射成 GitHub Pages 文件 URL，下拉选择后用 iframe 内嵌展示。
 *
 * 盘中报告有三份口径文件：eod-<date>.html（正式）、-obs（观察）、-intraday（盘中）。
 * 2026-09-22 起盘中运行也入库（tail_run.mode='intraday'），三种口径都能从
 * /api/tail/runs 直接列出，不再需要前端探测文件是否存在。
 */
import { ref, computed, onMounted, watch } from 'vue';
import { api, ApiError } from '../api/client';
import type { RunBatch, TailRun } from '../api/types';
import { tailModeLabel } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';

const props = defineProps<{ kind: 'eod' | 'tail' }>();

/** 报告站点根路径（GitHub Pages 项目页）；VITE_REPORTS_BASE 可覆盖。 */
const REPORTS_BASE = (
  (import.meta.env.VITE_REPORTS_BASE as string | undefined) ?? 'https://guosirius.github.io/candidate-pool'
).replace(/\/$/, '');

interface ReportEntry {
  key: string;
  label: string;
  url: string;
}

const entries = ref<ReportEntry[]>([]);
const loading = ref(false);
const error = ref('');
const selected = ref('');

const current = computed(() => entries.value.find((e) => e.key === selected.value) ?? null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  entries.value = [];
  selected.value = '';
  try {
    if (props.kind === 'eod') {
      // 盘后：anchor_date(YYYY-MM-DD) → reports/stock_list_<YYYYMMDD>.html
      const runs: RunBatch[] = await api.listRuns(100);
      entries.value = runs.map((r) => ({
        key: r.anchor_date,
        label: `${r.anchor_date}（盘后）`,
        url: `${REPORTS_BASE}/reports/stock_list_${r.anchor_date.replaceAll('-', '')}.html`,
      }));
    } else {
      // 盘中：日期 + 口径 → eod/reports/eod-<date>[-obs|-intraday].html
      const runs: TailRun[] = await api.getTailRuns(100);
      const seen = new Set<string>();
      for (const r of runs) {
        const key = `${r.trade_date}|${r.mode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const suffix = r.mode === 'observe' ? '-obs' : r.mode === 'intraday' ? '-intraday' : '';
        entries.value.push({
          key,
          label: `${r.trade_date}（${tailModeLabel(r.mode)}）`,
          url: `${REPORTS_BASE}/eod/reports/eod-${r.trade_date}${suffix}.html`,
        });
      }
    }
    // 日期倒序，同日内 正式 → 观察 → 盘中
    const order: Record<string, number> = { formal: 0, observe: 1, intraday: 2 };
    entries.value.sort((a, b) => {
      const [da, ma] = [a.key.split('|')[0], a.key.split('|')[1] ?? 'formal'];
      const [db, mb] = [b.key.split('|')[0], b.key.split('|')[1] ?? 'formal'];
      return da === db ? (order[ma] ?? 9) - (order[mb] ?? 9) : da < db ? 1 : -1;
    });
    if (entries.value.length) selected.value = entries.value[0].key;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.kind, load);
</script>

<template>
  <div class="rview">
    <PageHeader
      :title="kind === 'eod' ? '报告查看' : '尾盘报告查看'"
      :sub="kind === 'eod'
        ? '下拉选择盘后报告日期，页面内直接预览（来源：GitHub Pages）'
        : '下拉选择尾盘报告（正式 / 观察 / 盘中），页面内直接预览（来源：GitHub Pages）'"
    >
      <template #actions>
        <a v-if="current" class="ghost-btn" :href="current.url" target="_blank" rel="noopener">新窗口打开 ↗</a>
      </template>
    </PageHeader>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载报告列表…</p>
    <p v-else-if="!entries.length" class="hint">暂无可用报告。</p>

    <template v-else>
      <div class="toolbar">
        <label class="pick">
          <span>报告日期</span>
          <select v-model="selected">
            <option v-for="e in entries" :key="e.key" :value="e.key">{{ e.label }}</option>
          </select>
        </label>
      </div>

      <div class="frame-wrap" v-if="current">
        <iframe :src="current.url" :title="current.label" class="frame" loading="lazy"></iframe>
      </div>
      <p v-if="current" class="frame-hint">若内嵌区域空白，可能是网络无法访问 GitHub Pages，可点右上「新窗口打开」。</p>
    </template>
  </div>
</template>

<style scoped>
.rview { display: flex; flex-direction: column; gap: 14px; }
.toolbar { display: flex; align-items: center; gap: 12px; }
.pick { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.pick select {
  font: inherit; color: var(--fg, inherit); background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; min-width: 220px;
}
.frame-wrap {
  border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
  background: var(--surface); height: calc(100vh - 230px); min-height: 480px;
}
.frame { width: 100%; height: 100%; border: none; display: block; }
.frame-hint { color: var(--muted); font-size: 12px; margin: 0; }

.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; }
.ghost-btn:hover { text-decoration: underline; }
.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }

@media (max-width: 620px) {
  .pick select { min-width: 0; flex: 1; }
  .frame-wrap { height: calc(100vh - 200px); min-height: 380px; }
}
</style>
