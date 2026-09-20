<script setup lang="ts">
// 规则释义：内容与 README「规则速览」及 db/schema.sql 严格对齐。
const rules = [
  {
    id: 'R01',
    name: '量能验证突破',
    desc: '量价齐升的突破形态，是「重点关注」档位的核心判定。',
    gates: [
      'C1 成交量 ≥ 近 5 日均量 150%',
      'C2 收盘价突破前 10 日最高',
      'C3 当日涨幅 3%–8%',
      'C4 换手率 ≥ 3%',
      '市值 20–500 亿（流通/总市值同时校验）',
      '未处于 52 周高位区',
    ],
  },
  {
    id: 'R07',
    name: '板块内补涨',
    desc: '强势板块里相对滞涨的标的，等待补涨空间。',
    gates: [
      '所属申万一级行业当日涨幅居前 10%',
      '个股当日涨幅 < 行业涨幅的一半',
      '行业样本建议 ≥ 5 只，否则判定无意义（脚本会告警）',
    ],
  },
  {
    id: 'R05',
    name: '尾盘异动',
    desc: '尾盘资金抢筹信号，属「局部部分」维度。',
    gates: [
      '14:30–15:00 涨幅 ≥ 2%',
      '尾盘量能占比 ≥ 20%',
      '全天涨幅 < 7%',
      '分时接口仅返回最新交易日，历史锚定日标注为「数据缺口」而非信号缺失',
    ],
  },
];

const tiers = [
  { key: 'high', label: '重点', desc: 'R01 四道门槛（C1–C4）全部达标，量价突破最完整。', cond: 'r01_ok = 1（core = 4）' },
  { key: 'secondary', label: '次级', desc: 'R01 核心项达成 ≥ 3 项，且市值 / 高位区达标。', cond: 'core ≥ 3 且市值/高位达标' },
  { key: 'conditional', label: '条件', desc: 'R01 核心项达成 ≥ 2 项，且市值 / 高位区达标。', cond: 'core ≥ 2 且市值/高位达标' },
  { key: 'excluded', label: '排除', desc: '未达任何 R01 梯队；但可能仍触发 R07 / R05，前端按独立维度标出。', cond: 'r07_laggard / r05_partial 可能为 1' },
];

const columns = [
  { k: 'code', t: '代码', d: '沪深京 6 位代码（带 sh/sz/bj 前缀）。' },
  { k: 'name', t: '名称', d: '以行情接口返回为准。' },
  { k: 'tier', t: '档位', d: 'high / secondary / conditional / excluded（仅反映 R01 梯队）。' },
  { k: 'r01_chg', t: 'R01 涨跌', d: '当日涨幅 %（R01 口径）。' },
  { k: 'turnover', t: '换手率', d: '当日换手率 %（按成交量 ÷ 流通股本自行推算）。' },
  { k: 'vol_ratio', t: '量比', d: '当日成交量 ÷ 近 5 日均量（与 R01 C1 门槛同一口径，≥1.5 视为放量）。' },
  { k: 'circ_market_cap', t: '流通市值', d: '单位元，前端按亿/万换算展示。' },
  { k: 'total_market_cap', t: '总市值', d: '单位元，前端按亿/万换算展示。' },
  { k: 'sector_pct', t: '板块强度', d: '所属申万一级行业当日涨幅中位数 %。' },
];
</script>

<template>
  <div class="rules">
    <header class="page-head">
      <div>
        <h1>规则释义</h1>
        <p class="sub">初筛口径与档位划分依据</p>
      </div>
      <router-link class="ghost-btn" to="/">← 返回候选列表</router-link>
    </header>

    <section class="block">
      <h2>三条规则</h2>
      <div class="rule-cards">
        <article v-for="r in rules" :key="r.id" class="rule-card">
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

    <section class="block">
      <h2>四档分类</h2>
      <p class="note">报告按「重点关注 / 次级关注 / 条件观察 / 排除」四档分类。<code>tier</code> 仅表示 R01 梯队；即便为排除档，只要触发 R07 / R05 也会被写入（<code>r07_laggard</code> / <code>r05_partial</code> 标记），前端据此识别其入选维度。</p>
      <table class="grid">
        <thead>
          <tr><th>档位</th><th>含义</th><th>入选条件</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in tiers" :key="t.key">
            <td><span class="tier-badge" :class="`tier-${t.key}`">{{ t.label }}</span></td>
            <td>{{ t.desc }}</td>
            <td class="cond">{{ t.cond }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="block">
      <h2>列表字段释义</h2>
      <table class="grid">
        <thead>
          <tr><th>字段</th><th>名称</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in columns" :key="c.k">
            <td class="mono">{{ c.k }}</td>
            <td>{{ c.t }}</td>
            <td>{{ c.d }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="block">
      <h2>N 日表现（复盘底座）</h2>
      <p class="note">
        股票详情页与复盘统计页的 <code>perf</code> 给出该票相对入选价（锚定日收盘）的
        <code>n1 / n2 / n3 / n5 / n7 / n9 / n10</code> 日涨幅（%）：收益 = (该日后收盘 − 入选价) ÷ 入选价。
        这里的 <b>N = 相对锚定日之后的第 N 个筛选周期 / 交易日</b>——例如想看「入选后 3 日内」的表现，就重点比较
        <code>N1 / N2 / N3</code> 三列（N1 即入选后的下一个周期）。数据缺失时显示 <code>—</code>；
        颜色惯例 <b>红 = 涨、绿 = 跌</b>（A 股口径）。
      </p>
    </section>
  </div>
</template>

<style scoped>
.rules { display: flex; flex-direction: column; gap: 22px; }
.page-head { display: flex; align-items: center; justify-content: space-between; }
.page-head h1 { font-size: 22px; margin: 0; }
.sub { color: var(--muted); margin: 4px 0 0; font-size: 13px; }
.ghost-btn { color: var(--accent); text-decoration: none; font-size: 14px; }
.ghost-btn:hover { text-decoration: underline; }

.block h2 { font-size: 16px; margin: 0 0 12px; }
.note { color: var(--muted); font-size: 13px; line-height: 1.7; margin: 0 0 12px; }
.note code, .desc code { background: var(--surface); padding: 1px 5px; border-radius: 4px; font-size: 12px; }

.rule-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.rule-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.rule-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.rule-head h3 { font-size: 15px; margin: 0; }
.tag { background: rgba(31,111,235,0.18); color: #79c0ff; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 13px; }
.desc { color: var(--muted); font-size: 13px; margin: 0 0 10px; line-height: 1.6; }
.rule-card ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.rule-card li { font-size: 12.5px; color: var(--text); line-height: 1.5; }

.grid { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.grid th, .grid td { padding: 10px 12px; text-align: left; }
.grid thead th { background: var(--surface); color: var(--muted); font-weight: 600; }
.grid tbody tr { border-top: 1px solid var(--border); }
.grid .cond, .grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }

.tier-badge { display: inline-flex; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.tier-high { background: rgba(248,81,73,0.16); color: #ff7b72; }
.tier-secondary { background: rgba(210,153,34,0.16); color: #e3b341; }
.tier-conditional { background: rgba(88,166,255,0.16); color: #79c0ff; }
.tier-excluded { background: rgba(139,148,158,0.16); color: #8b949e; }
</style>
