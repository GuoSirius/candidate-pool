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
 *
 * 「具体报告」是可输入过滤的 combobox（原生 select 无法过滤，单类型可达上百份）：
 *   - 输入按 label / file / date / variant 做多关键词 AND 匹配，空格分隔；
 *   - 键盘 ↑↓ 移动、Enter 选中、Esc 收起；mousedown.prevent 选项目的是避开 blur 抢先关列表；
 *   - 收起时输入框显示当前选中项，展开时清空并显示「当前：xxx」占位提示。
 * 不引入任何第三方组件，零新增依赖。「报告类型」只有 7 项，保持原生 select。
 */
import { ref, computed, onMounted, watch, nextTick } from 'vue';
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

/* ---------- 具体报告：可输入过滤的 combobox ---------- */
const searchOpen = ref(false);
const searchText = ref('');
const activeIndex = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);
const comboEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const filteredReports = computed<ArchiveReport[]>(() => {
  const words = searchText.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return reports.value;
  return reports.value.filter((r) => {
    const hay = `${r.label} ${r.file} ${r.date} ${r.variant}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
});

/** 展开时显示用户正在输入的关键词；收起时显示当前选中项（保持原来下拉的观感） */
const inputValue = computed({
  get: () => (searchOpen.value ? searchText.value : (current.value?.label ?? '')),
  set: (v: string) => {
    searchText.value = v;
    activeIndex.value = 0;
    // Esc 收起后输入框仍有焦点，继续打字要能自动重新展开，否则输入会被 getter 覆盖
    if (!searchOpen.value) searchOpen.value = true;
  },
});

function openSearch(): void {
  if (searchOpen.value) return;
  searchText.value = '';
  activeIndex.value = Math.max(0, reports.value.findIndex((r) => r.url === selectedUrl.value));
  searchOpen.value = true;
}
function closeSearch(): void {
  searchOpen.value = false;
  searchText.value = '';
}
function pickReport(r: ArchiveReport): void {
  selectedUrl.value = r.url;
  closeSearch();
  searchInput.value?.blur();
}
function move(delta: number): void {
  if (!searchOpen.value) {
    openSearch();
    return;
  }
  const n = filteredReports.value.length;
  if (!n) return;
  activeIndex.value = (activeIndex.value + delta + n) % n;
  void nextTick(() => {
    listEl.value
      ?.querySelector<HTMLElement>(`[data-idx="${activeIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });
}
function chooseActive(): void {
  // 列表收起时按 Enter 只展开，不误切到 activeIndex 指向的其它报告
  if (!searchOpen.value) {
    openSearch();
    return;
  }
  const r = filteredReports.value[activeIndex.value];
  if (r) pickReport(r);
}
function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (comboEl.value && next && comboEl.value.contains(next)) return;
  closeSearch();
}
function clearSearch(): void {
  searchText.value = '';
  activeIndex.value = 0;
  searchInput.value?.focus();
}

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
    closeSearch();
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
  closeSearch();
  syncQuery();
});
watch(selectedUrl, syncQuery);
</script>

<template>
  <div class="aview">
    <PageHeader
      title="历史报告归档"
      sub="主分支全量历史报告与数据档 · 与本站同源发布 · 具体报告支持输入过滤后页内预览"
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
          <div ref="comboEl" class="combo" @focusout="onFocusOut">
            <input
              ref="searchInput"
              v-model="inputValue"
              class="combo-input"
              type="text"
              autocomplete="off"
              role="combobox"
              aria-controls="report-listbox"
              :aria-expanded="searchOpen"
              :aria-activedescendant="searchOpen && filteredReports.length ? 'report-opt-' + activeIndex : undefined"
              :placeholder="current ? `当前：${current.label} · 输入日期或关键词过滤` : '输入关键词过滤…'"
              @focus="openSearch"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="chooseActive"
              @keydown.esc.prevent="closeSearch"
            />
            <button
              v-if="searchOpen && searchText"
              class="combo-clear"
              type="button"
              aria-label="清空过滤"
              @mousedown.prevent="clearSearch"
            >×</button>
            <div v-if="searchOpen" id="report-listbox" ref="listEl" class="combo-list" role="listbox">
              <div class="combo-head">共 {{ reports.length }} 份 · 匹配 {{ filteredReports.length }} 份</div>
              <div
                v-for="(r, idx) in filteredReports"
                :id="'report-opt-' + idx"
                :key="r.url"
                :data-idx="idx"
                class="combo-opt"
                :class="{ active: idx === activeIndex, chosen: r.url === selectedUrl }"
                role="option"
                :aria-selected="r.url === selectedUrl"
                @mousedown.prevent="pickReport(r)"
              >
                <span class="opt-main">{{ r.label }}</span>
                <span class="opt-sub">{{ r.file }}</span>
              </div>
              <div v-if="!filteredReports.length" class="combo-empty">没有匹配的报告，换个日期或关键词试试</div>
            </div>
          </div>
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

/* 可输入过滤的「具体报告」 */
.combo { position: relative; flex: 1; min-width: 0; }
.combo-input {
  box-sizing: border-box; width: 100%; font: inherit;
  color: var(--fg, inherit); background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; padding: 7px 30px 7px 10px;
}
.combo-input:focus { outline: none; border-color: var(--accent); }
.combo-input::placeholder { color: var(--muted); opacity: .85; }
.combo-clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 22px; height: 22px; line-height: 20px; text-align: center;
  border: none; background: transparent; color: var(--muted); cursor: pointer; font-size: 16px;
}
.combo-list {
  position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0;
  max-height: min(360px, 55vh); overflow: auto;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, .32); padding: 4px;
}
.combo-head {
  position: sticky; top: 0; z-index: 1; background: var(--surface);
  padding: 6px 10px 8px; margin-bottom: 2px; color: var(--muted);
  font-size: 12px; border-bottom: 1px solid var(--border);
}
.combo-opt {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 7px 10px; border-radius: 6px; cursor: pointer;
  font-size: 13px; color: var(--fg, inherit);
}
.combo-opt.active { background: rgba(128, 140, 160, .18); }
.combo-opt.chosen .opt-main { color: var(--accent); font-weight: 600; }
.opt-main { white-space: nowrap; }
.opt-sub {
  color: var(--muted); font-size: 11px; max-width: 55%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.combo-empty { padding: 16px 10px; text-align: center; color: var(--muted); font-size: 12px; }

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
  .pick select, .pick.grow select, .combo-input { min-width: 0; flex: 1; }
  .combo-list { max-height: 46vh; }
  .opt-sub { display: none; }
  .data-label { margin-left: 0; }
  .frame-wrap { height: calc(100vh - 260px); min-height: 380px; }
}
</style>
