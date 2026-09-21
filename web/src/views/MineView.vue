<script setup lang="ts">
/*
 * 「我的」汇总页：自选分组 + 备注备忘的集中浏览。
 *
 * 背景：评论 / 分组的编辑入口此前只藏在个股详情页（写面板还依赖写令牌），
 * 用户没有一张「我到底建了哪些组、写过哪些备注」的总览页。
 * 本页只做**只读汇总**（创建 / 编辑 / 删除仍留在详情页，避免两处维护一套写 UI）：
 *   - 分组：卡片列表，点击展开成员（懒加载 getGroupDetail）；
 *   - 备注：全量表格（GET /api/notes 联表带名称/行业），点标的进详情。
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../api/client';
import type { GroupDetail, NoteListItem, WatchGroup } from '../api/types';
import { useColumnSort } from '../utils/sort';
import { openStock } from '../utils/nav';
import PageHeader from '../components/PageHeader.vue';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const error = ref('');

// —— 分组 ——
const groups = ref<WatchGroup[]>([]);
const expanded = ref<number | null>(null);
const groupDetail = ref<GroupDetail | null>(null);
const detailLoading = ref(false);

async function toggleGroup(id: number) {
  if (expanded.value === id) {
    expanded.value = null;
    groupDetail.value = null;
    return;
  }
  expanded.value = id;
  groupDetail.value = null;
  detailLoading.value = true;
  try {
    groupDetail.value = await api.getGroup(id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    detailLoading.value = false;
  }
}

// —— 备注 ——
const notes = ref<NoteListItem[]>([]);
const NOTE_TYPE_LABEL: Record<string, string> = { comment: '评论', memo: '备忘' };

// 后端按创建时间倒序返回（有业务含义，故 initialKey: null 保持默认顺序）
const { sortKey, sortDir, toggle, sortRows } = useColumnSort<keyof NoteListItem>({
  initialKey: null,
  dirFor: (key) => (key === 'created_at' ? 'desc' : undefined),
});
const sortedNotes = computed(() =>
  sortRows(notes.value, (row, key) => row[key] as never),
);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [gs, ns] = await Promise.all([api.listGroups(), api.listNotes()]);
    groups.value = gs;
    notes.value = ns;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <PageHeader
      title="分组与备注"
      sub="自选分组与备注备忘的集中总览；新增与编辑在个股详情页进行（需先设置写令牌）"
    />

    <p v-if="loading" class="state">加载中…</p>
    <p v-else-if="error" class="state err">{{ error }}</p>

    <template v-else>
      <section class="sec">
        <h2>自选分组 <span class="cnt">{{ groups.length }}</span></h2>
        <p v-if="!groups.length" class="state">
          还没有分组。在个股详情页「加入分组」即可建立自己的观察清单。
        </p>
        <div v-else class="group-list">
          <div v-for="g in groups" :key="g.id" class="gcard">
            <button type="button" class="ghead" @click="toggleGroup(g.id)">
              <span class="gdot" :style="{ background: g.color || 'var(--accent)' }" />
              <b>{{ g.name }}</b>
              <span class="gdesc">{{ g.description || '' }}</span>
              <span class="gchev">{{ expanded === g.id ? '收起 ▲' : '展开 ▼' }}</span>
            </button>
            <div v-if="expanded === g.id" class="gbody">
              <p v-if="detailLoading" class="state">加载成员中…</p>
              <p v-else-if="!groupDetail || !groupDetail.members.length" class="state">该分组暂无成员。</p>
              <div v-else-if="groupDetail && groupDetail.members.length" class="table-wrap">
                <table class="grid">
                  <thead>
                    <tr><th>代码</th><th>名称</th><th>行业</th><th>组内备注</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="m in groupDetail.members" :key="m.code">
                      <td class="mono">{{ m.code.replace(/^[a-z]+/, '') }}</td>
                      <td>
                        <a href="#" @click.prevent="openStock(router, route, m.code)">
                          {{ m.name || m.code }}
                        </a>
                      </td>
                      <td>{{ m.sector || '—' }}</td>
                      <td class="wrap">{{ m.note || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="sec">
        <h2>备注与备忘 <span class="cnt">{{ notes.length }}</span></h2>
        <p v-if="!notes.length" class="state">
          还没有备注。在个股详情页底部写下评论或备忘后，会汇总到这里。
        </p>
        <div v-else class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th v-for="col in [
                  { key: 'created_at', label: '时间' },
                  { key: 'code', label: '代码' },
                  { key: 'name', label: '名称' },
                  { key: 'sector', label: '行业' },
                  { key: 'type', label: '类型' },
                  { key: 'content', label: '内容' },
                  { key: 'anchor_date', label: '锚定日' },
                ]" :key="col.key" :class="{ sorted: sortKey === col.key }">
                  <button type="button" class="th-btn" @click="toggle(col.key)">
                    {{ col.label }}
                    <span v-if="sortKey === col.key" class="arrow">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in sortedNotes" :key="n.id">
                <td class="mono">{{ (n.created_at || '').slice(0, 16) || '—' }}</td>
                <td class="mono">{{ n.code.replace(/^[a-z]+/, '') }}</td>
                <td>
                  <a href="#" @click.prevent="openStock(router, route, n.code)">
                    {{ n.name || n.code }}
                  </a>
                </td>
                <td>{{ n.sector || '—' }}</td>
                <td>{{ NOTE_TYPE_LABEL[n.type || 'comment'] || n.type || '—' }}</td>
                <td class="wrap">{{ n.content }}</td>
                <td class="mono">{{ n.anchor_date || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.sec h2 { font-size: 16px; margin: 0 0 10px; display: flex; align-items: baseline; gap: 8px; }
.cnt { color: var(--muted); font-size: 13px; font-weight: 400; }
.state { color: var(--muted); font-size: 13px; }
.state.err { color: var(--danger, #dc2626); }
.mono { font-variant-numeric: tabular-nums; white-space: nowrap; }
.wrap { white-space: normal; min-width: 200px; }

.group-list { display: flex; flex-direction: column; gap: 10px; }
.gcard { border: 1px solid var(--border, #ddd); border-radius: 10px; overflow: hidden; }
.ghead {
  display: flex; align-items: baseline; gap: 10px; width: 100%;
  padding: 10px 14px; border: 0; background: transparent; cursor: pointer;
  font: inherit; text-align: left;
}
.ghead:hover { background: rgba(127, 127, 127, 0.06); }
.gdot { width: 10px; height: 10px; border-radius: 50%; flex: none; align-self: center; }
.gdesc { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gchev { margin-left: auto; color: var(--muted); font-size: 12px; flex: none; }
.gbody { padding: 4px 14px 12px; border-top: 1px solid var(--border, #ddd); }
.table-wrap { border: 1px solid var(--border, #ddd); border-radius: 10px; overflow: hidden; }

/* 窄屏：备注 7 列 / 分组成员 4 列，保留表格形态 + 容器内横向滚动；表头不逐字换行 */
@media (max-width: 820px) {
  .table-wrap, .gbody { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 0; }
  .table-wrap .grid { min-width: 640px; }
  .gbody .grid { min-width: 480px; }
  .grid thead th { white-space: nowrap; }
}
</style>
