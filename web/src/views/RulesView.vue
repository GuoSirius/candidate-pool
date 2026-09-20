<script setup lang="ts">
// 规则释义：内容全部来自 src/constants/glossary.ts（唯一事实来源），
// 与 README「规则速览」、db/schema.sql、gen_candidates.js 的判定口径保持一致。
import {
  RULES,
  TIERS,
  RULE_FLAGS,
  FIELDS,
  STAT_DEFS,
  HORIZONS,
  H_LABEL,
  H_OFFSET,
  H_COLOR,
  H_SHORT,
  HORIZON_NOTE,
  type Horizon,
} from '../constants/glossary';

/** N 周期分组：N1–N3 为短周期（入选后 3 个交易日内），N5–N10 为中长周期。 */
function groupOf(h: Horizon): string {
  return H_SHORT.includes(h) ? '短周期（3 日内）' : '中长周期';
}
</script>

<template>
  <div class="rules">
    <header class="page-head">
      <div>
        <h1>规则释义</h1>
        <p class="sub">初筛口径、档位划分、N 日周期与统计指标的完整说明</p>
      </div>
      <div class="head-links">
        <router-link class="ghost-btn" to="/stats">复盘统计 →</router-link>
        <router-link class="ghost-btn" to="/">← 返回候选列表</router-link>
      </div>
    </header>

    <!-- 1. 三条规则 -->
    <section class="block">
      <h2>三条规则（R01 / R07 / R05）</h2>
      <p class="note">
        R01 是<b>唯一决定档位</b>的主线；R07、R05 是与档位<b>并列的独立维度</b>——只要命中就会被记录，即使该票落在「排除」档。
      </p>
      <div class="rule-cards">
        <article v-for="r in RULES" :key="r.id" class="rule-card">
          <div class="rule-head">
            <span class="tag">{{ r.id }}</span>
            <h3>{{ r.name }}</h3>
          </div>
          <p class="desc">{{ r.desc }}</p>
          <ul>
            <li v-for="(g, i) in r.gates" :key="i">{{ g }}</li>
          </ul>
        </article>
      </div>
    </section>

    <!-- 2. 四档分类 -->
    <section class="block">
      <h2>四档分类（重点 / 次级 / 条件 / 排除）</h2>
      <p class="note">
        报告与列表按四档分类。<code>tier</code> <b>仅表示 R01 梯队</b>，不代表综合推荐度；即便为「排除」档，只要触发 R07 / R05 也会被写入。
      </p>
      <table class="grid">
        <colgroup>
          <col style="width: 12%" />
          <col style="width: 50%" />
          <col style="width: 38%" />
        </colgroup>
        <thead>
          <tr><th>档位</th><th>含义</th><th>入选条件</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in TIERS" :key="t.key">
            <td class="ctr"><span class="tier-badge" :class="`tier-${t.key}`">{{ t.label }}</span></td>
            <td class="wrap">{{ t.desc }}</td>
            <td class="cond">{{ t.cond }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 3. 判定标记位 -->
    <section class="block">
      <h2>判定标记位（记录里存了什么）</h2>
      <p class="note">列表「规则」列的 R01 / R07 / R05 标签，以及列表中不直接展示但参与判定的字段：</p>
      <table class="grid">
        <colgroup>
          <col style="width: 18%" />
          <col style="width: 14%" />
          <col style="width: 68%" />
        </colgroup>
        <thead>
          <tr><th>字段</th><th>名称</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="f in RULE_FLAGS" :key="f.k">
            <td class="mono">{{ f.k }}</td>
            <td class="ctr">{{ f.t }}</td>
            <td class="wrap">{{ f.d }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 4. N 日周期一览 -->
    <section class="block">
      <h2>N 日周期一览（N1 / N2 / N3 / N5 / N7 / N9 / N10）</h2>
      <p class="legend head">{{ HORIZON_NOTE }}</p>
      <table class="grid">
        <colgroup>
          <col style="width: 12%" />
          <col style="width: 40%" />
          <col style="width: 20%" />
          <col style="width: 28%" />
        </colgroup>
        <thead>
          <tr><th>周期</th><th>对应</th><th>分组</th><th>走势图配色</th></tr>
        </thead>
        <tbody>
          <tr v-for="h in HORIZONS" :key="h">
            <td class="hname ctr">{{ H_LABEL[h] }}</td>
            <td>锚定日之后的第 {{ H_OFFSET[h] }} 个交易日收盘 vs 入选价</td>
            <td class="cond">{{ groupOf(h) }}</td>
            <td>
              <span class="swatch" :style="{ background: H_COLOR[h] }"></span>
              <span class="mono">{{ H_COLOR[h] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="legend">
        全部 7 个周期在<b>个股复盘页</b>（每期入选的 N 列）与<b>复盘统计页</b>（各档命中率、平均收益走势、锚定日明细）中都会出现；
        走势图可按周期勾选 / 取消，颜色即上表配色。距锚定日过近时后段周期会缺数据（例：N10 需要其后 10 个交易日），显示 <code>—</code>。
      </p>
    </section>

    <!-- 5. 字段释义 -->
    <section class="block">
      <h2>候选列表字段释义</h2>
      <table class="grid">
        <colgroup>
          <col style="width: 18%" />
          <col style="width: 14%" />
          <col style="width: 68%" />
        </colgroup>
        <thead>
          <tr><th>字段</th><th>名称</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in FIELDS" :key="c.k">
            <td class="mono">{{ c.k }}</td>
            <td class="ctr">{{ c.t }}</td>
            <td class="wrap">{{ c.d }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 6. 统计口径 -->
    <section class="block">
      <h2>统计口径（复盘统计页）</h2>
        <table class="grid">
          <colgroup>
            <col style="width: 20%" />
            <col style="width: 80%" />
          </colgroup>
          <thead>
            <tr><th>指标</th><th>含义</th></tr>
          </thead>
          <tbody>
            <tr v-for="d in STAT_DEFS" :key="d.k">
              <td class="ctr">{{ d.t }}</td>
              <td class="wrap">{{ d.d }}</td>
            </tr>
        </tbody>
      </table>
      <p class="legend">颜色惯例：<b>红 = 正、绿 = 负</b>（A 股口径）；无数据显示 <code>—</code>，与「0%」区分。</p>
    </section>
  </div>
</template>

<style scoped>
.rules { display: flex; flex-direction: column; gap: 22px; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-head h1 { font-size: 22px; margin: 0; }
.sub { color: var(--muted); margin: 4px 0 0; font-size: 13px; }
.head-links { display: flex; gap: 14px; }
.ghost-btn { color: var(--accent); text-decoration: none; font-size: 14px; white-space: nowrap; }
.ghost-btn:hover { text-decoration: underline; }

.block h2 { font-size: 16px; margin: 0 0 12px; }
.note { color: var(--muted); font-size: 13px; line-height: 1.7; margin: 0 0 12px; }
.note code, .desc code, .legend code { background: var(--surface); padding: 1px 5px; border-radius: 4px; font-size: 12px; }

.rule-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.rule-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.rule-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.rule-head h3 { font-size: 15px; margin: 0; }
.tag { background: rgba(31,111,235,0.18); color: #79c0ff; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 13px; }
.desc { color: var(--muted); font-size: 13px; margin: 0 0 10px; line-height: 1.6; }
.rule-card ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.rule-card li { font-size: 12.5px; color: var(--text); line-height: 1.5; }

.grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.grid th, .grid td { padding: 10px 12px; text-align: left; overflow-wrap: anywhere; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid th.ctr, .grid td.ctr { text-align: center; }
.grid .cond, .grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }
.grid .wrap { line-height: 1.65; }
.grid .hname { font-weight: 700; color: var(--text); }
.swatch { display: inline-block; width: 14px; height: 2px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }

.tier-badge { display: inline-flex; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.tier-high { background: rgba(248,81,73,0.16); color: #ff7b72; }
.tier-secondary { background: rgba(210,153,34,0.16); color: #e3b341; }
.tier-conditional { background: rgba(88,166,255,0.16); color: #79c0ff; }
.tier-excluded { background: rgba(139,148,158,0.16); color: #8b949e; }

.legend { color: var(--muted); font-size: 12px; margin: 10px 0 0; line-height: 1.75; }
.legend.head { margin: 0 0 12px; background: rgba(31,111,235,0.08); border: 1px solid rgba(31,111,235,0.25); border-radius: 8px; padding: 8px 10px; }
</style>
