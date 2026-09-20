<script setup lang="ts">
// 「写权限」控件：管理本机保存的写令牌（WRITE_TOKEN）。
// 与详情页共用 utils/writeToken.ts 里的响应式变量，改完即时联动。
//
// placement：
//   'down' —— 面板向下弹出（用于移动端顶部栏，右对齐）
//   'up'   —— 面板向上、左对齐弹出（用于桌面左栏页脚与移动端抽屉页脚，
//             这两处左侧没有空间，向下弹会被视口裁掉）
import { ref } from 'vue';
import { writeToken, setWriteToken, clearWriteToken } from '../utils/writeToken';

withDefaults(defineProps<{ placement?: 'down' | 'up' }>(), { placement: 'down' });

const open = ref(false);
const draft = ref('');

function toggle(): void {
  open.value = !open.value;
  if (open.value) draft.value = writeToken.value;
}

function save(): void {
  setWriteToken(draft.value);
  open.value = false;
}

function clear(): void {
  clearWriteToken();
  draft.value = '';
  open.value = false;
}
</script>

<template>
  <div class="wt">
    <button class="wt-btn" type="button" @click="toggle">
      写权限
      <span class="dot" :class="{ on: !!writeToken }" :title="writeToken ? '已设置令牌' : '未设置令牌'"></span>
    </button>

    <div v-if="open" class="wt-panel" :class="placement">
      <p class="wt-tip">
        备注与分组的<b>写入</b>需要在 Worker 侧配置机密变量 <code>WRITE_TOKEN</code>
        （<code>wrangler secret put WRITE_TOKEN</code>），再在这里填入同一个令牌。
        未配置时写接口会返回 10005，站点仍可正常只读浏览。
      </p>
      <input
        v-model="draft"
        class="wt-input"
        type="password"
        autocomplete="off"
        placeholder="粘贴 WRITE_TOKEN"
        @keyup.enter="save"
      />
      <div class="wt-actions">
        <button class="wt-primary" type="button" @click="save">保存</button>
        <button class="wt-ghost" type="button" @click="clear">清除</button>
      </div>
      <p class="wt-note">令牌只存在本机浏览器 localStorage，不写入代码库与构建产物；换设备需重填。</p>
    </div>
  </div>
</template>

<style scoped>
.wt { position: relative; display: inline-flex; }

.wt-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; padding: 0; font-family: inherit;
  font-size: 14px; color: var(--muted); cursor: pointer;
}
.wt-btn:hover { color: var(--text); }

/* 状态点：灰 = 未设置，绿 = 已设置 */
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--border); }
.dot.on { background: #3fb950; }

.wt-panel {
  position: absolute; z-index: 70;
  /* 抽屉里可用宽度可能只有 ~320px，硬写 340px 会溢出视口 */
  width: min(340px, calc(100vw - 44px));
  padding: 12px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.wt-panel.down { top: calc(100% + 10px); right: 0; }
/* 左栏 / 抽屉页脚：左侧没空间，改为向上弹、左对齐 */
.wt-panel.up { bottom: calc(100% + 10px); left: 0; }

.wt-tip { margin: 0 0 10px; font-size: 12px; line-height: 1.7; color: var(--muted); }
.wt-tip code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px;
  padding: 0 4px; color: var(--accent);
}
.wt-input {
  width: 100%; padding: 7px 9px; font-size: 13px; font-family: inherit;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px;
}
.wt-input:focus { outline: none; border-color: var(--accent); }
.wt-actions { display: flex; gap: 8px; margin-top: 10px; }
.wt-primary, .wt-ghost {
  font-family: inherit; font-size: 12.5px; padding: 5px 12px;
  border-radius: 6px; cursor: pointer; border: 1px solid var(--border);
}
.wt-primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.wt-primary:hover { background: #2b7ef5; }
.wt-ghost { background: none; color: var(--muted); }
.wt-ghost:hover { color: var(--text); }
.wt-note { margin: 10px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
</style>
