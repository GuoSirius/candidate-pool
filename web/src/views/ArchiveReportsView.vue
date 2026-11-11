<script setup lang="ts">
/*
 * 历史报告归档页（双下拉 + iframe）
 * ---------------------------------------------------------------------------
 * 与 ReportsView.vue 的区别（别合并成一个组件）：
 *   - ReportsView 读 D1 runs 表、报告托管在 GitHub Pages（不同源），只覆盖 2 类、按运行记录枚举；
 *   - 本页读构建期生成的 /archive/index.json，报告与本站**同源静态资源**，
 *     覆盖全部 7 类历史 HTML（含周报 / 回流），按「类型 → 具体文件」两级枚举。
 *
 * 为什么必须走 index.json：Cloudflare Pages 不提供目录列表 API，前端无法列目录。
 * 清单由 web/scripts/build-archive.mjs 在 npm run build / dev 前生成，不进 git。
 *
 * 选择状态写进 URL query（?type=&file=），便于直接分享某一份报告；只在初次加载时读回。
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { formatCN } from '../utils/date';

interface ArchiveReport {
  file: string;
  date: string;
  variant: string;
  size: number;
  url: string;
  label: string;
}
interface ArchiveData {
  file: string;
  date: string;
  size: number;
  url: string;
}
interface ArchiveType {
  key: string;
  label: string;
  reports: ArchiveReport[];
  data: ArchiveData[];
  count: number;
  dataCount: number;
}
interface ArchiveIndex {
  schema: number;
  generatedAt: string;
  base: string;
  fingerprint: string;
  totalReports: number;
  totalData: number;
  types: ArchiveType[];
}

const INDEX_URL = '/archive/index.json';
const route = useRoute();
const router = useRouter();

const doc = ref<ArchiveIndex | null>(null);
const loading = ref(false);
const error = ref('');
const selectedType = ref('');
const selectedUrl = ref('');

const types = computed<ArchiveType[]>(() => doc.value?.types ?? []);
const currentType = computed(() => types.value.find((t) => t.key === selectedType.value) ?? null);
const reports = computed<ArchiveReport[]>(() => currentType.value?.reports ?? []);
const current = computed(() => reports.value.find((r) => r.url === selectedUrl.value) ?? null);
/** 同一交易日的同源数据档（weekly / reflow 无逐日数据档，自然为空） */
const relatedData = computed<ArchiveData[]>(() => {
  const t = currentType.value;
  const r = current.value;
  if (!t || !r) return [];
  return t.data.filter((d) => d.date === r.date);
});
const generated = computed(() => (doc.value ? formatCN(doc.value.generatedAt) : '—'));

function fmtSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** 同步到 URL，便于分享；不监听 route 变化，避免与用户操作互相触发 */
function syncQuery(): void {
  const query: Record<string, string> = {};
  if (selectedType.value) query.type = selectedType.value;
  if (current.value) query.file = current.value.file;
  router.replace({ query });
}

async function load(applyQuery = false): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    // no-store：每次部署指纹都变，清单绝不能被浏览器 / SW 缓存成旧的
    const res = await fetch(INDEX_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`清单请求失败 HTTP ${res.status}`);
    const json = (await res.json()) as ArchiveIndex;
    if (!Array.isArray(json.types)) throw new Error('清单结构异常：缺 types');
    doc.value = json;

    const wantedType = applyQuery ? String(route.query.type ?? '') : selectedType.value;
    const wantedFile = applyQuery ? String(route.query.file ?? '') : current.value?.file ?? '';
    const t = json.types.find((x) => x.key === wantedType) ?? json.types[0] ?? null;
    selectedType.value = t?.key ?? '';
    const r = t?.reports.find((x) => x.file === wantedFile) ?? t?.reports[0] ?? null;
    selectedUrl.value = r?.url ?? '';
  } catch (e) {
    doc.value = null;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(true));
watch(selectedType, (key) => {
  selectedUrl.value = types.value.find((t) => t.key === key)?.reports[0]?.url ?? '';
  syncQuery();
});
watch(selectedUrl, syncQuery);
</script>

<template>
  <div class="aview">
    <PageHeader
      title="历史报告归档"
      sub="主分支全量历史报告与数据档 · 与本站同源发布 · 两个下拉框定位后页内预览"
    >
      <template #actions>
        <a v-if="current" class="ghost-btn" :href="current.url" target="_blank" rel="noopener">新窗口打开 ↗</a>
        <button class="ghost-btn linklike" type="button" :disabled="loading" @click="load(false)">刷新清单</button>
      </template>
    </PageHeader>

    <p v-if="error" class="error">归档清单加载失败：{{ error }}。若为本地开发，请先执行 <code>node scripts/build-archive.mjs</code>。</p>
    <p v-else-if="loading" class="hint">加载归档清单…</p>
    <p v-else-if="!types.length" class="hint">暂无可用归档报告。</p>

    <template v-else>
      <div class="toolbar">
        <label class="pick">
          <span>报告类型</span>
          <select v-model="selectedType">
            <option v-for="t in types" :key="t.key" :value="t.key">
              {{ t.label }}（{{ t.count }}）
            </option>
          </select>
        </label>
        <label class="pick grow">
          <span>具体报告</span>
          <select v-model="selectedUrl">
            <option v-for="r in reports" :key="r.url" :value="r.url">{{ r.label }}</option>
          </select>
        </label>
      </div>

      <div class="meta-row">
        <span v-if="current">{{ current.file }} · {{ fmtSize(current.size) }}</span>
        <span>清单生成于 {{ generated }}（北京）· 共 {{ doc?.totalReports }} 份报告 / {{ doc?.totalData }} 份数据档</span>
        <template v-if="relatedData.length">
          <span class="data-label">该日数据档：</span>
          <a v-for="d in relatedData" :key="d.url" :href="d.url" target="_blank" rel="noopener">{{ d.file }}</a>
        </template>
      </div>

      <div class="frame-wrap" v-if="current">
        <iframe :src="current.url" :title="current.label" class="frame" loading="lazy"></iframe>
      </div>
      <p v-else class="hint">该类型下暂无报告。</p>
      <p v-if="current" class="frame-hint">报告为单文件 HTML、资源全内联；表格可左右滑动，票表「代码 + 名称」两列固定、其余表首列固定，长表表头常驻。若内嵌区域空白，可点右上「新窗口打开」。</p>
    </template>

    <p class="foot-note">
      仍在用 GitHub Pages 的旧版报告？<router-link to="/reports">盘后报告查看</router-link> /
      <router-link to="/tail/reports">尾盘报告查看</router-link> 保持原样可用。
    </p>
  </div>
</template>

<style scoped>
.aview { display: flex; flex-direction: column; gap: 14px; }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pick { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.pick.grow { flex: 1; min-width: 260px; }
.pick select {
  font: inherit; color: var(--fg, inherit); background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; min-width: 180px;
}
.pick.grow select { flex: 1; min-width: 0; }
.meta-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
  color: var(--muted); font-size: 12px;
}
.meta-row a { color: var(--accent); text-decoration: none; }
.meta-row a:hover { text-decoration: underline; }
.data-label { margin-left: auto; }
.frame-wrap {
  border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
  background: var(--surface); height: calc(100vh - 250px); min-height: 480px;
}
.frame { width: 100%; height: 100%; border: none; display: block; }
.frame-hint, .foot-note { color: var(--muted); font-size: 12px; margin: 0; }
.foot-note a { color: var(--accent); text-decoration: none; }
.foot-note a:hover { text-decoration: underline; }
.ghost-btn { color: var(--accent); text-decoration: none; font-size: 13px; }
.ghost-btn:hover { text-decoration: underline; }
.linklike { background: none; border: none; padding: 0; cursor: pointer; font: inherit; color: var(--accent); }
.linklike:disabled { opacity: .5; cursor: default; }
.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.3); padding: 10px 12px; border-radius: 8px; }
.error code { font-size: 12px; }

@media (max-width: 620px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .pick, .pick.grow { width: 100%; }
  .pick select, .pick.grow select { min-width: 0; flex: 1; }
  .data-label { margin-left: 0; }
  .frame-wrap { height: calc(100vh - 260px); min-height: 380px; }
}
</style>
