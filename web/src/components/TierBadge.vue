<script setup lang="ts">
import type { Tier } from '../api/types';
import { TIER_LABELS } from '../api/types';

defineProps<{ tier: Tier }>();
</script>

<template>
  <span class="tier-badge" :class="`tier-${tier}`">{{ TIER_LABELS[tier] }}</span>
</template>

<style scoped>
.tier-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
}
.tier-high { background: rgba(248, 81, 73, 0.16); color: #ff7b72; }
.tier-secondary { background: rgba(210, 153, 34, 0.16); color: #e3b341; }
.tier-conditional { background: rgba(88, 166, 255, 0.16); color: #79c0ff; }
.tier-excluded { background: rgba(139, 148, 158, 0.16); color: #8b949e; }
</style>
