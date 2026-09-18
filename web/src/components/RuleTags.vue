<script setup lang="ts">
import type { PickRecord } from '../api/types';

// 规则命中标签：R01 主线领涨、R07 补涨滞后、R05 局部部分。1 表示命中。
const props = defineProps<{ pick: PickRecord }>();

interface RuleTag {
  key: 'r01_ok' | 'r07_laggard' | 'r05_partial';
  label: string;
  title: string;
}
const RULES: RuleTag[] = [
  { key: 'r01_ok', label: 'R01', title: 'R01 量能验证突破：量价齐升突破形态（量≥5日均量150%、突破前10日高、涨幅3%–8%、换手≥3%、市值20–500亿、未处52周高位）' },
  { key: 'r07_laggard', label: 'R07', title: 'R07 板块内补涨：所属申万一级行业居前10%，且个股涨幅 < 行业涨幅的一半' },
  { key: 'r05_partial', label: 'R05', title: 'R05 尾盘异动：14:30–15:00 涨幅≥2% 且尾盘量能占比≥20% 且全天涨幅<7%（分时缺口时标注为数据缺口）' },
];
</script>

<template>
  <span class="rule-tags">
    <span
      v-for="r in RULES"
      :key="r.key"
      class="rule-tag"
      :class="{ on: props.pick[r.key] === 1 }"
      :title="r.title"
    >{{ r.label }}</span>
  </span>
</template>

<style scoped>
.rule-tags { display: inline-flex; gap: 4px; }
.rule-tag {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid transparent;
}
.rule-tag:not(.on) {
  background: rgba(139, 148, 158, 0.12);
  color: #6e7681;
  opacity: 0.6;
}
.rule-tag.on {
  background: rgba(31, 111, 235, 0.18);
  color: #79c0ff;
  border-color: rgba(121, 192, 255, 0.4);
}
</style>
