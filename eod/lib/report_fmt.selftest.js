'use strict';
/*
 * eod/lib/report_fmt.selftest.js —— 共享格式化纯函数的回归自测
 * ---------------------------------------------------------------------------
 * 运行：node eod/lib/report_fmt.selftest.js  （退出码非 0 = 失败；纯函数，不联网）
 * 重点：minifyHTML 的「零语义风险」契约、b() 属性编码、双语往返一致性。
 */

const {
  minifyHTML, b, esc,
  HOT_TIER_ORDER, hotTierAttr, hotTierCounts, hotTierChipValue,
} = require('./report_fmt');

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '  FAIL'}  ${name}${cond || detail === undefined ? '' : `  → ${detail}`}`);
  if (!cond) failed++;
}

console.log('\n[1] minifyHTML：只折叠空白，不改写 CSS 字符串内容（评审 #8）');
const styled = '<style>\n  .a::before { content: "a: b, c"; }\n</style>';
const mini = minifyHTML(styled);
check('content 字符串保持原样', mini.includes('content: "a: b, c"'), mini);
check('不再产出 content:"a:b,c"', !mini.includes('content:"a:b,c"'), mini);
const multiline = '<div>\n    <span>x</span>\n\n    <span>y</span>\n</div>';
const m2 = minifyHTML(multiline);
check('去行首缩进', !m2.includes('\n    '), JSON.stringify(m2));
check('去空行', !m2.includes('\n\n'), JSON.stringify(m2));
check('保留标签间换行（inline 间距不变）', m2.split('\n').length === 4, m2.split('\n').length);

console.log('\n[2] b()：属性编码（03 报告 §2.3 回归）');
const hb = b('A"B', 'E"N');
check('data-zh 中的双引号已编码', hb.includes('data-zh="A&quot;B"'), hb);
check('data-en 中的双引号已编码', hb.includes('data-en="E&quot;N"'), hb);

console.log('\n[3] 双语往返：先 esc 再传 b() 不会造成显示漂移（04 报告 §4 #9 后半为误报）');
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const z = `降级观察：${esc('A&B')} 胜率持续 < 30%`;
const html = b(z, z);
const raw = html.match(/data-zh="([^"]*)"/)[1];
const content = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</span>'));
check('首次渲染 === EN→中文切回后的渲染', decode(content) === decode(decode(raw)), `${decode(content)} | ${decode(decode(raw))}`);

console.log('\n[4] 游资层级：行属性与 chip 值必须严格对得上');
const bb = { hot: [{ name: '章盟主', tier: '一线' }, { name: '某席位', tier: '一线' }, { name: '散户大本营', tier: '避坑' }, { name: '无层级' }] };
const attr = hotTierAttr(bb);
check('同层级去重', attr.split('|').length === 2, attr);
check('中文已编码、无裸中文', !/[^\x00-\x7F]/.test(attr), attr);
check('chip 值去前缀后命中行属性', attr.split('|').indexOf(hotTierChipValue('一线').slice('@htier:'.length)) >= 0, attr);
check('无游资/无 billboard 返回空串', hotTierAttr(null) === '' && hotTierAttr({ hot: [] }) === '');
const recs = [
  { billboard: bb },
  { billboard: { hot: [{ tier: '二线' }] } },
  { billboard: null },
  { billboard: { hot: [{ tier: '游资新档' }] } },
];
const tc = hotTierCounts(recs);
check('固定三档恒出现（含 0 命中）', HOT_TIER_ORDER.every((t) => tc.order.includes(t) && tc.counts[t] != null), JSON.stringify(tc));
check('票数按「票」去重、不按席位数', tc.counts['一线'] === 1 && tc.counts['避坑'] === 1, JSON.stringify(tc.counts));
check('归档新层级追加在后', tc.order.indexOf('游资新档') === 3 && tc.counts['游资新档'] === 1, JSON.stringify(tc));
check('自定义取 billboard（收盘表口径）', hotTierCounts([{ close: { billboard: { hot: [{ tier: '二线' }] } } }], (c) => c.close.billboard).counts['二线'] === 1);

console.log(`\n${failed ? `自测失败 ${failed} 项` : '全部通过'}`);
process.exit(failed ? 1 : 0);
