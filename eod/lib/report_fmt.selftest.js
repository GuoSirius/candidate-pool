'use strict';
/*
 * eod/lib/report_fmt.selftest.js —— 共享格式化纯函数的回归自测
 * ---------------------------------------------------------------------------
 * 运行：node eod/lib/report_fmt.selftest.js  （退出码非 0 = 失败；纯函数，不联网）
 * 重点：minifyHTML 的「零语义风险」契约、b() 属性编码、双语往返一致性。
 */

const { minifyHTML, b, esc } = require('./report_fmt');

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

console.log(`\n${failed ? `自测失败 ${failed} 项` : '全部通过'}`);
process.exit(failed ? 1 : 0);
