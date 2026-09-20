<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, BizCode } from '../api/client';
import type { StockHistory, StockNote, NoteType, WatchGroup, PickRecord, Perf } from '../api/types';
import { fmtNum, fmtPct, perfClass } from '../utils/format';
import { HORIZONS, H_LABEL, HORIZON_NOTE_SHORT, type Horizon } from '../constants/glossary';
import { goBack, backLabelOf } from '../utils/nav';
import { useColumnSort, type SortValue } from '../utils/sort';
import { writeToken } from '../utils/writeToken';
import TierBadge from '../components/TierBadge.vue';
import RuleTags from '../components/RuleTags.vue';
import PageHeader from '../components/PageHeader.vue';

const route = useRoute();
const router = useRouter();

const code = computed(() => String(route.params.code));
const data = ref<StockHistory | null>(null);
const loading = ref(false);
const error = ref<string>('');

// 「从哪来、回哪去」：返回按钮文案跟随来源页，行为见 utils/nav.ts
const backLabel = computed(() => backLabelOf(route));
function back() {
  goBack(router, route);
}

// ---------------------------------------------------------------------------
// 写能力：备注 / 分组
// ---------------------------------------------------------------------------

/** 本机是否已填写令牌（等于「界面可编辑」的开关）。 */
const canWrite = computed(() => !!writeToken.value);
/** 服务端返回 10005 时的原文提示（顺带覆盖「Worker 未配置 WRITE_TOKEN」的情形）。 */
const writeHint = ref('');
/** 操作轻提示：成功为绿色提示，失败为红色。 */
const msg = ref('');
const msgKind = ref<'ok' | 'err'>('ok');
const busy = ref(false);

function say(text: string, kind: 'ok' | 'err' = 'ok'): void {
  msg.value = text;
  msgKind.value = kind;
}

/** 全部已有分组（用于「加入已有分组」下拉）。 */
const allGroups = ref<WatchGroup[]>([]);

async function loadGroups(): Promise<void> {
  try {
    allGroups.value = await api.listGroups();
  } catch {
    allGroups.value = [];
  }
}

/**
 * 写操作统一入口：置忙 → 执行 → 清/置提示。
 * 10005（无写权限）单独走 writeHint，用「怎么启用」的口径提示，而不是当成报错。
 * 返回 null 表示失败，调用方据此决定是否继续（如清空表单）。
 */
async function write<T>(task: () => Promise<T>): Promise<T | null> {
  busy.value = true;
  msg.value = '';
  try {
    const result = await task();
    writeHint.value = '';
    return result;
  } catch (e) {
    const text = e instanceof ApiError ? e.message : String(e);
    if (e instanceof ApiError && e.code === BizCode.ERR_FORBIDDEN) writeHint.value = text;
    else say(`失败：${text}`, 'err');
    return null;
  } finally {
    busy.value = false;
  }
}

/** 写成功后重取详情与分组清单，保证界面与库内一致。 */
async function refresh(): Promise<void> {
  await Promise.all([load(code.value), loadGroups()]);
}

// ---- 备注 ----

const noteType = ref<NoteType>('comment');
/** '' = 通用备注（不限某次入选） */
const noteAnchor = ref('');
const noteDraft = ref('');
const editingNoteId = ref<number | null>(null);
const editDraft = ref('');

function resetNoteForm(): void {
  noteDraft.value = '';
  noteAnchor.value = '';
  noteType.value = 'comment';
}

async function submitNote(): Promise<void> {
  if (!noteDraft.value.trim()) {
    say('内容不能为空', 'err');
    return;
  }
  const saved = await write(() =>
    api.createNote({
      code: code.value,
      content: noteDraft.value,
      type: noteType.value,
      anchor_date: noteAnchor.value || null,
    }),
  );
  if (!saved) return;
  resetNoteForm();
  say('备注已保存');
  await refresh();
}

function startEdit(n: StockNote): void {
  editingNoteId.value = n.id;
  editDraft.value = n.content;
}

function cancelEdit(): void {
  editingNoteId.value = null;
  editDraft.value = '';
}

async function saveEdit(n: StockNote): Promise<void> {
  if (!editDraft.value.trim()) {
    say('内容不能为空', 'err');
    return;
  }
  const updated = await write(() => api.updateNote(n.id, { content: editDraft.value }));
  if (!updated) return;
  cancelEdit();
  say('备注已更新');
  await refresh();
}

async function removeNote(n: StockNote): Promise<void> {
  if (!window.confirm('删除这条备注？删除后不可恢复。')) return;
  const done = await write(() => api.deleteNote(n.id));
  if (!done) return;
  say('备注已删除');
  await refresh();
}

// ---- 分组 ----

const pickGroupId = ref(0);
const newGroupName = ref('');

const myGroupIds = computed(() => new Set((data.value?.groups ?? []).map((g) => g.id)));
const addableGroups = computed(() => allGroups.value.filter((g) => !myGroupIds.value.has(g.id)));

function chipStyle(g: WatchGroup): Record<string, string> {
  return { color: g.color || '#8b949e', borderColor: g.color || '#30363d' };
}

async function addToGroup(): Promise<void> {
  if (!pickGroupId.value) return;
  const target = pickGroupId.value;
  const done = await write(() => api.addStockToGroup(target, code.value));
  if (!done) return;
  pickGroupId.value = 0;
  say('已加入分组');
  await refresh();
}

async function createAndAdd(): Promise<void> {
  const name = newGroupName.value.trim();
  if (!name) return;
  // 分两步：先建组拿到 id，再加入；任一步失败都不继续
  const created = await write(() => api.createGroup({ name }));
  if (!created) return;
  const joined = await write(() => api.addStockToGroup(created.id, code.value));
  if (!joined) return;
  newGroupName.value = '';
  say(`已新建分组「${name}」并加入`);
  await refresh();
}

async function removeFromGroup(g: WatchGroup): Promise<void> {
  if (!window.confirm(`把 ${code.value} 移出分组「${g.name}」？（不会删除分组与入选记录）`)) return;
  const done = await write(() => api.removeStockFromGroup(g.id, code.value));
  if (!done) return;
  say(`已移出「${g.name}」`);
  await refresh();
}

// ---------------------------------------------------------------------------

async function load(c: string): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.getStock(c);
  } catch (e) {
    data.value = null;
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

const base = computed(() => data.value?.base ?? null);
const picks = computed(() => data.value?.picks ?? []);

// —— 入选记录表排序：锚定日 / 入选价 / N1…N10 列头可点 ——
// 默认「锚定日倒序」，与接口返回顺序一致；空值（该周期还没数据）恒排最后。
type PickSortKey = 'anchor' | 'price' | Horizon;
const {
  sortKey: pickSortKey,
  sortDir: pickSortDir,
  toggle: togglePickSort,
  sortRows: sortPickRows,
} = useColumnSort<PickSortKey>({
  initialKey: 'anchor',
  initialDir: 'desc',
  numericKeys: ['price', ...HORIZONS],
  dirFor: (k) => (k === 'anchor' ? 'desc' : undefined),
});

function pickSortValue(p: PickRecord & { perf: Perf | null }, k: PickSortKey): SortValue {
  if (k === 'anchor') return p.anchor_date;
  if (k === 'price') return p.price;
  return p.perf?.[k] ?? null;
}

const sortedPicks = computed(() => sortPickRows(picks.value, pickSortValue));

/** 列头箭头：仅当前排序列显示方向。 */
function pickArrow(k: PickSortKey): string {
  if (pickSortKey.value !== k) return '';
  return pickSortDir.value === 'desc' ? '▼' : '▲';
}

// 各周期复盘汇总：逐 N 统计有数据的样本数、平均、最佳、最差。
const perfSummary = computed(() =>
  HORIZONS.map((h) => {
    const vals = picks.value.map((p) => p.perf?.[h]).filter((v): v is number => typeof v === 'number');
    if (!vals.length) return { h, n: 0, avg: null as number | null, best: null as number | null, worst: null as number | null };
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { h, n: vals.length, avg, best: Math.max(...vals), worst: Math.min(...vals) };
  }),
);

watch(code, (c) => {
  // 换票时把编辑态与提示清干净，避免把上一只票的草稿带过来
  cancelEdit();
  resetNoteForm();
  msg.value = '';
  writeHint.value = '';
  load(c);
}, { immediate: false });

onMounted(() => {
  load(code.value);
  loadGroups();
});
</script>

<template>
  <div class="stock">
    <PageHeader
      :title="code"
      :sub="base?.sector ? base.sector + (base.region ? ` · ${base.region}` : '') : ''"
    >
      <template #before>
        <button class="ghost-btn" type="button" @click="back">← {{ backLabel }}</button>
      </template>
      <template #title>
        <span class="code">{{ code }}</span>
        <span class="name" v-if="base?.name">{{ base.name }}</span>
      </template>
      <template #actions>
        <router-link class="ghost-btn" to="/rules">规则释义 →</router-link>
      </template>
    </PageHeader>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="hint">加载股票档案…</p>

    <template v-else-if="data">
      <p v-if="msg" class="flash" :class="msgKind">{{ msg }}</p>

      <!-- 基础档案 -->
      <section class="card" v-if="base">
        <h2>基础档案</h2>
        <div class="kv">
          <div v-if="base.concepts"><span class="k">题材</span><span class="v">{{ base.concepts }}</span></div>
          <div v-if="base.main_business"><span class="k">主营</span><span class="v">{{ base.main_business }}</span></div>
          <div v-if="base.top_business"><span class="k">最赚钱业务</span><span class="v">{{ base.top_business }}</span></div>
        </div>
      </section>

      <!-- 分组 -->
      <section class="card">
        <h2>分组</h2>

        <p v-if="writeHint" class="gate">{{ writeHint }}</p>
        <p v-else-if="!canWrite" class="gate">
          未设置写令牌，暂不可编辑。点右上角<b>「写权限」</b>填入与 Worker 一致的 <code>WRITE_TOKEN</code> 后即可管理分组。
        </p>

        <div class="chips">
          <span v-for="g in data.groups" :key="g.id" class="gchip" :style="chipStyle(g)">
            {{ g.name }}
            <button
              v-if="canWrite"
              class="x"
              type="button"
              title="移出该分组"
              :disabled="busy"
              @click="removeFromGroup(g)"
            >×</button>
          </span>
          <span v-if="!data.groups.length" class="empty">尚未加入任何分组</span>
        </div>

        <div class="row" v-if="canWrite">
          <select v-model.number="pickGroupId" :disabled="busy || !addableGroups.length">
            <option :value="0">{{ addableGroups.length ? '选择已有分组…' : '没有可加入的分组' }}</option>
            <option v-for="g in addableGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <button class="btn" type="button" :disabled="busy || !pickGroupId" @click="addToGroup">加入</button>
          <span class="sep">或</span>
          <input
            v-model="newGroupName"
            class="inp"
            type="text"
            maxlength="30"
            placeholder="新建分组名（≤30 字）"
            :disabled="busy"
            @keyup.enter="createAndAdd"
          />
          <button class="btn" type="button" :disabled="busy || !newGroupName.trim()" @click="createAndAdd">新建并加入</button>
        </div>
      </section>

      <!-- 备注 / 备忘 -->
      <section class="card">
        <h2>备注 / 备忘</h2>

        <p v-if="writeHint" class="gate">{{ writeHint }}</p>
        <p v-else-if="!canWrite" class="gate">
          未设置写令牌，暂不可编辑。点右上角<b>「写权限」</b>填入令牌后即可新增 / 修改备注。
        </p>

        <div class="note-form" v-if="canWrite">
          <div class="nf-row">
            <select v-model="noteType" :disabled="busy">
              <option value="comment">评论</option>
              <option value="memo">备忘</option>
            </select>
            <select v-model="noteAnchor" :disabled="busy">
              <option value="">通用（不限某次入选）</option>
              <option v-for="p in picks" :key="p.id" :value="p.anchor_date">{{ p.anchor_date }}</option>
            </select>
            <span class="counter">{{ noteDraft.length }}/500</span>
          </div>
          <textarea
            v-model="noteDraft"
            rows="3"
            maxlength="500"
            placeholder="写点什么…（判断依据 / 后续跟踪 / 复盘结论）"
            :disabled="busy"
          ></textarea>
          <div class="nf-actions">
            <button class="btn primary" type="button" :disabled="busy || !noteDraft.trim()" @click="submitNote">保存备注</button>
          </div>
        </div>

        <ul class="notes" v-if="data.notes.length">
          <li v-for="n in data.notes" :key="n.id">
            <template v-if="editingNoteId === n.id">
              <textarea v-model="editDraft" class="edit-area" rows="2" maxlength="500" :disabled="busy"></textarea>
              <div class="nf-actions">
                <button class="btn primary" type="button" :disabled="busy" @click="saveEdit(n)">保存</button>
                <button class="btn" type="button" :disabled="busy" @click="cancelEdit">取消</button>
              </div>
            </template>
            <template v-else>
              <span class="ntype">{{ n.type === 'memo' ? '备忘' : '评论' }}</span>
              <span class="ncontent">{{ n.content }}</span>
              <span class="nmeta">
                <span v-if="n.anchor_date" class="nanchor">{{ n.anchor_date }}</span>
                <span v-if="n.created_at" class="ctime">{{ n.created_at.slice(0, 16) }}</span>
                <template v-if="canWrite">
                  <button class="lnk" type="button" :disabled="busy" @click="startEdit(n)">改</button>
                  <button class="lnk danger" type="button" :disabled="busy" @click="removeNote(n)">删</button>
                </template>
              </span>
            </template>
          </li>
        </ul>
        <p v-else class="empty">
          还没有备注。选中一次入选（或留「通用」）写一条，之后复盘时能看到当时的判断依据。
        </p>
      </section>

      <!-- 各周期复盘汇总：卡片形式，一个周期一张卡 -->
      <section class="card" v-if="picks.length">
        <h2>入选后各周期表现（复盘）</h2>
        <p class="legend head">
          口径：每次入选都以<b>该期入选价（锚定日收盘价）</b>为基准，取 N 个交易日后的收盘价相对它的涨跌幅。
          每张卡对应一个周期，<b>样本</b> = 该票历史入选记录中「该周期已有数据」的条数；
          <b>平均</b> = 这些样本的算术平均，<b>最佳 / 最差</b> = 同一批样本里的最大值 / 最小值。
          三者都是跟「入选价」比，不是样本之间互相比。
        </p>
        <div class="stat-row">
          <div class="stat" v-for="s in perfSummary" :key="s.h">
            <div class="stat-h">
              <span class="hn">{{ H_LABEL[s.h] }}</span>
              <span class="hs">样本 {{ s.n || '—' }}</span>
            </div>
            <div class="stat-main">
              <span class="sl">平均</span>
              <span class="sv" :class="perfClass(s.avg)">{{ fmtPct(s.avg) }}</span>
            </div>
            <div class="stat-sub">
              <span>最佳 <b :class="perfClass(s.best)">{{ fmtPct(s.best) }}</b></span>
              <span>最差 <b :class="perfClass(s.worst)">{{ fmtPct(s.worst) }}</b></span>
            </div>
          </div>
        </div>
        <p class="legend">距锚定日过近时后段周期暂无数据，显示 —；颜色惯例 红 = 正、绿 = 负。</p>
      </section>

      <!-- 各期入选与 N 日收益 -->
      <section class="card">
        <h2>入选记录（共 {{ picks.length }} 期）</h2>
        <div class="table-wrap">
          <table class="grid">
            <colgroup>
              <col style="width: 5%" />
              <col style="width: 11%" />
              <col style="width: 6.5%" />
              <col style="width: 8.5%" />
              <col style="width: 7.5%" />
              <col v-for="h in HORIZONS" :key="h" style="width: 8.8%" />
            </colgroup>
            <thead>
              <tr>
                <th class="ctr idx">序号</th>
                <th class="ctr sortable" :class="{ sorted: pickSortKey === 'anchor' }">
                  <button class="th-btn" type="button" @click="togglePickSort('anchor')">
                    <span>锚定日</span><span class="arrow">{{ pickArrow('anchor') }}</span>
                  </button>
                </th>
                <th class="ctr">档位</th><th class="ctr">规则</th>
                <th class="num sortable" :class="{ sorted: pickSortKey === 'price' }">
                  <button class="th-btn" type="button" @click="togglePickSort('price')">
                    <span>入选价</span><span class="arrow">{{ pickArrow('price') }}</span>
                  </button>
                </th>
                <th
                  v-for="h in HORIZONS"
                  :key="h"
                  class="num sortable"
                  :class="{ sorted: pickSortKey === h }"
                >
                  <button class="th-btn" type="button" @click="togglePickSort(h)">
                    <span>{{ H_LABEL[h] }}</span><span class="arrow">{{ pickArrow(h) }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in sortedPicks" :key="p.id">
                <td class="ctr idx">{{ i + 1 }}</td>
                <td class="mono ctr">{{ p.anchor_date }}</td>
                <td class="ctr"><TierBadge :tier="p.tier" /></td>
                <td class="ctr"><RuleTags :pick="p" /></td>
                <td class="num">{{ fmtNum(p.price) }}</td>
                <td v-for="h in HORIZONS" :key="h" class="num" :class="perfClass(p.perf?.[h])">
                  {{ fmtPct(p.perf?.[h]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="legend">
          {{ HORIZON_NOTE_SHORT }}涨 = 红，跌 = 绿；数据缺失显示 —。
          <b>点列头</b>可按锚定日 / 入选价 / 任一 N 周期排序（再点一次切换升降序），空值恒排在最后。
          首列<b>序号</b>按当前展示顺序编号（排序后跟着重排）。
          档位（重点 / 次级 / 条件 / 排除）与 R01 / R07 / R05 标签含义见
          <router-link to="/rules">规则释义</router-link>。
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.stock { display: flex; flex-direction: column; gap: 16px; }
/* 标题行（h1 / .sub / 返回链接）统一在 components/PageHeader.vue，
   这里只保留详情页特有的「代码 + 名称」呈现。
   .code / .name 是塞进 PageHeader 具名插槽的节点 —— 插槽内容编译在父组件作用域，
   因此仍带本组件的 data-v 属性，选择器照常生效。 */
.page-head .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent); }
.page-head .name { font-size: 18px; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.card h2 { font-size: 15px; margin: 0 0 12px; }
.kv { display: flex; flex-direction: column; gap: 8px; }
.kv > div { display: flex; gap: 10px; font-size: 13px; }
.kv .k { color: var(--muted); min-width: 84px; }
.kv .v { line-height: 1.6; }

/* ---- 轻提示 / 门禁说明 ---- */
.flash { margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.flash.ok { color: #3fb950; background: rgba(63,185,80,0.1); border: 1px solid rgba(63,185,80,0.3); }
.flash.err { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); }

.gate {
  margin: 0 0 12px; padding: 8px 10px; font-size: 12.5px; line-height: 1.7;
  color: var(--muted); background: var(--surface-2);
  border: 1px dashed var(--border); border-radius: 8px;
}
.gate code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
  padding: 0 4px; color: var(--accent);
}

/* ---- 分组 ---- */
.chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gchip {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid; border-radius: 999px; padding: 2px 10px; font-size: 12px;
}
.gchip .x {
  background: none; border: none; padding: 0; margin: 0; font-family: inherit;
  font-size: 13px; line-height: 1; color: inherit; opacity: 0.65; cursor: pointer;
}
.gchip .x:hover { opacity: 1; }
.gchip .x:disabled { opacity: 0.3; cursor: default; }

.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.sep { color: var(--muted); font-size: 12px; }

select, .inp, textarea {
  font-family: inherit; font-size: 12.5px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px;
}
select:focus, .inp:focus, textarea:focus { outline: none; border-color: var(--accent); }
select:disabled, .inp:disabled, textarea:disabled { opacity: 0.55; cursor: not-allowed; }
.inp { min-width: 180px; }

.btn {
  font-family: inherit; font-size: 12.5px; padding: 5px 12px; cursor: pointer;
  background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px;
}
.btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.btn.primary:hover:not(:disabled) { background: #2b7ef5; color: #fff; }

/* ---- 备注 ---- */
.note-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.nf-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nf-row .counter { margin-left: auto; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.note-form textarea { width: 100%; resize: vertical; line-height: 1.6; }
.edit-area { width: 100%; resize: vertical; line-height: 1.6; }
.nf-actions { display: flex; gap: 8px; }

.notes { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.notes li {
  display: flex; gap: 10px; align-items: baseline; font-size: 13px; flex-wrap: wrap;
  border-top: 1px solid var(--border); padding-top: 10px;
}
.notes li:first-child { border-top: none; padding-top: 0; }
.notes li:has(.edit-area) { flex-direction: column; align-items: stretch; }
.ntype { color: var(--accent); font-weight: 600; font-size: 12px; flex: none; }
.ncontent { line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.nmeta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.nanchor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }
.ctime { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.lnk {
  background: none; border: none; padding: 0; font-family: inherit; font-size: 12px;
  color: var(--accent); cursor: pointer;
}
.lnk:hover { text-decoration: underline; }
.lnk.danger { color: #ff7b72; }
.lnk:disabled { opacity: 0.45; cursor: not-allowed; text-decoration: none; }

.empty { color: var(--muted); font-size: 12.5px; margin: 0; }

/* 各周期复盘卡片：一个 N 周期一张卡 */
.stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.stat { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.stat-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.stat-h .hn { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 700; color: var(--accent); }
.stat-h .hs { font-size: 11px; color: var(--muted); }
.stat-main { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.stat-main .sl { font-size: 12px; color: var(--muted); }
.stat-main .sv { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat-sub { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--muted); border-top: 1px dashed var(--border); padding-top: 6px; }
.stat-sub b { font-variant-numeric: tabular-nums; }

.table-wrap { overflow: hidden; border: 1px solid var(--border); border-radius: 12px; }
.grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12.5px; }
.grid th, .grid td { padding: 8px 8px; text-align: left; overflow-wrap: anywhere; }
.grid thead th { color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); line-height: 1.3; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 12px; }
/* 序号列：按当前展示顺序编号（排序后跟着重排），只做定位参考 */
.grid .idx { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11.5px; white-space: nowrap; }
.grid th.ctr, .grid td.ctr { text-align: center; }
.grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; white-space: nowrap; }
.grid :deep(.rule-tags) { gap: 2px; }
.grid :deep(.rule-tag) { padding: 0 4px; font-size: 10px; }
.up { color: #ff7b72; }
.down { color: #3fb950; }
.flat { color: var(--muted); }
.legend { color: var(--muted); font-size: 12px; margin: 10px 0 0; line-height: 1.75; }
.legend.head { margin: 0 0 12px; background: rgba(31,111,235,0.08); border: 1px solid rgba(31,111,235,0.25); border-radius: 8px; padding: 8px 10px; }

.hint { color: var(--muted); padding: 20px 0; text-align: center; }
.error { color: #ff7b72; background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); padding: 10px 12px; border-radius: 8px; }
</style>
