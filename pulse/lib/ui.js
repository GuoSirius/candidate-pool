'use strict';
/*
 * pulse/lib/ui.js —— 控制台美化输出
 * ANSI 颜色仅在 TTY 下启用（重定向到 watch-console.log 时自动纯文本，不污染日志）；
 * PULSE_FORCE_COLOR=1 可强制启用。符号选用 GBK 安全字符（√×▲▼●｜─），Windows 老控制台不乱码。
 */
const TTY = process.env.PULSE_FORCE_COLOR === '1' || (process.stdout && process.stdout.isTTY);

const c = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));

module.exports = {
  dim: c('2'), bold: c('1'), cyan: c('36'), green: c('32'),
  red: c('31'), yellow: c('33'), gray: c('90'), magenta: c('35'),
  LINE: '─'.repeat(58),
  /** 涨跌幅带方向箭头：▲3.2% / ▼1.2% */
  pctArrow: (p) => (p == null ? '' : p >= 0 ? `▲${p}%` : `▼${Math.abs(p)}%`),
  /** 资金方向：●净流入12.5亿 / ●净流出3亿 */
  flowText: (flow) => {
    if (flow == null || flow === 0) return '';
    return flow > 0 ? `净流入${flow}亿` : `净流出${Math.abs(flow)}亿`;
  },
  /** 信源状态行："OK 60条" → √东财60（绿）；"FAIL xxx" → ×sina（红） */
  sourcesLine: (status, labels) => Object.entries(status)
    .map(([k, v]) => {
      const m = v.match(/(\d+)/);
      const label = (labels && labels[k]) || k;
      return v.startsWith('OK')
        ? `${c('32')('√')}${label}${m ? `·${m[1]}` : ''}`
        : `${c('31')('×')}${label}`;
    }).join(' '),
  /** 事件行着色：行情异动=红（紧急）、共振=黄、消息热点=绿 */
  colorEvent: (e) => {
    if (e.startsWith('行情异动')) return c('31')('● ') + e;
    if (e.includes('共振')) return c('33')('● ') + e;
    return c('32')('● ') + e;
  },
  /** 热点榜紧凑文本：通信设备 40·A·5源 ▲3.2% ｜ … */
  hotText: (hotBoards, n = 4) => hotBoards.slice(0, n)
    .map((b) => `${c('1')(b.name)} ${c('33')(String(b.score))}·${b.verify}${b.sourceCount ? '·' + b.sourceCount + '源' : ''}${b.pct != null ? ' ' + module.exports.pctArrow(b.pct) : ''}`)
    .join(c('2')(' ｜ ')),
};
