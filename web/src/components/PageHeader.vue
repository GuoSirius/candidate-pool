<script setup lang="ts">
/*
 * 页面标题行（各页统一）。
 *
 * 此前 5 个视图各自写一份 `<header class="page-head">` + 自己的 h1/sub 样式，
 * 结果字号、间距、窄屏表现逐页漂移（例如 StockView 的 .sub 是 margin:0，
 * 其余页是 margin:4px 0 0；ghost-btn 有的是 13px 有的是 14px）。
 * 统一到这里之后：
 *   - 排版只有一处定义；
 *   - 窄屏（≤620px）标题行自动改为纵向堆叠，右侧操作链接换行，避免标题被挤成两三个字；
 *   - 新增页面直接复用，不需要再抄一遍样式。
 *
 * 插槽：
 *   before  —— 标题上方的内容（如详情页的「← 返回候选列表」）
 *   title   —— 自定义标题内容（如详情页的「代码 + 名称」）；给了它就不渲染 title 文案
 *   actions —— 右侧操作区（文字链接 / 按钮）
 */
defineProps<{ title: string; sub?: string }>();
</script>

<template>
  <header class="page-head">
    <div class="ph-main">
      <slot name="before" />
      <h1 v-if="!$slots.title">{{ title }}</h1>
      <h1 v-else><slot name="title" /></h1>
      <p v-if="sub" class="sub">{{ sub }}</p>
    </div>
    <div v-if="$slots.actions" class="ph-actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.ph-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.page-head h1 {
  font-size: 22px;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.sub { color: var(--muted); margin: 0; font-size: 13px; line-height: 1.6; }
.ph-actions { flex: none; display: flex; align-items: center; gap: 14px; }

/* 窄屏：操作链接不跟标题抢一行，标题也不再被压成两三字一行的换行噩梦 */
@media (max-width: 620px) {
  .page-head { flex-direction: column; align-items: stretch; gap: 10px; }
  .page-head h1 { font-size: 20px; }
  .ph-actions { flex-wrap: wrap; gap: 12px; }
}
</style>
