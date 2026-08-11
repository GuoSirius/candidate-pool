'use strict';
/*
 * notify.js
 * ---------------------------------------------------------------------------
 * 实时结果推送（零外部依赖，仅用 Node 内置 https / tls）：
 *   - 个人微信：Server酱 (sctapi.ftqq.com) 或 PushPlus (pushplus.plus)
 *   - 163 邮箱：SMTP_SSL (smtp.163.com:465)，HTML 报告作为附件发送
 *
 * 配置来源（凭据不要写进脚本 / 不要提交）：
 *   notify_config.json  或  环境变量（NOTIFY_WX_KEY / NOTIFY_WX_TOKEN /
 *   NOTIFY_WX_PROVIDER / NOTIFY_MAIL_SENDER / NOTIFY_MAIL_AUTH /
 *   NOTIFY_MAIL_RECEIVER / NOTIFY_MAIL_HOST / NOTIFY_MAIL_PORT）
 *
 * 用法（在 gen_candidates.js 中 require 后调用）：
 *   const { notify } = require('./notify');
 *   await notify({ title, content, htmlPath });
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const tls = require('tls');
const { URL } = require('url');

const CFG_PATH = path.join(__dirname, 'notify_config.json');

function loadCfg() {
  const cfg = {};
  if (fs.existsSync(CFG_PATH)) {
    try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))); } catch (e) { /* 损坏则忽略 */ }
  }
  const wx = cfg.wechat || (cfg.wechat = {});
  if (process.env.NOTIFY_WX_KEY) wx.key = process.env.NOTIFY_WX_KEY;
  if (process.env.NOTIFY_WX_TOKEN) wx.token = process.env.NOTIFY_WX_TOKEN;
  if (process.env.NOTIFY_WX_PROVIDER) wx.provider = process.env.NOTIFY_WX_PROVIDER;
  const em = cfg.email || (cfg.email = {});
  const map = {
    sender: 'NOTIFY_MAIL_SENDER', auth_code: 'NOTIFY_MAIL_AUTH',
    receiver: 'NOTIFY_MAIL_RECEIVER', smtp_host: 'NOTIFY_MAIL_HOST', smtp_port: 'NOTIFY_MAIL_PORT',
  };
  for (const k in map) if (process.env[map[k]]) em[k] = process.env[map[k]];
  return cfg;
}

// ---------- HTTP POST ----------
function postForm(urlStr, form, json) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = json
      ? JSON.stringify(form)
      : Object.keys(form).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(form[k])).join('&');
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------- 微信推送 ----------
async function pushWechat(title, content, cfg) {
  const w = cfg.wechat || {};
  const provider = (w.provider || 'serverchan').toLowerCase();
  try {
    if (provider === 'serverchan') {
      const key = w.key || process.env.NOTIFY_WX_KEY;
      if (!key) return [false, '缺少 serverchan key'];
      const r = await postForm(`https://sctapi.ftqq.com/${key}.send`, { title, desp: content });
      let d; try { d = JSON.parse(r.body); } catch (e) { d = {}; }
      return [(d.code === 0 || d.errno === 0), d];
    } else if (provider === 'pushplus') {
      const token = w.token || process.env.NOTIFY_WX_TOKEN;
      if (!token) return [false, '缺少 pushplus token'];
      const r = await postForm('https://www.pushplus.plus/send',
        { token, title, content, template: 'markdown' }, true);
      let d; try { d = JSON.parse(r.body); } catch (e) { d = {}; }
      return [d.code === 200, d];
    }
    return [false, '未知 provider: ' + provider];
  } catch (e) {
    return [false, String(e && e.message || e)];
  }
}

// ---------- 163 邮箱（最小 SMTP_SSL 客户端，无 nodemailer 依赖）----------
function smtpSend({ host, port, user, pass, from, to, subject, text, htmlPath }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: Number(port), rejectUnauthorized: true });
    let leftover = '';
    let current = null;
    let ready = false;

    function send(cmd) { socket.write(cmd + '\r\n'); }
    function next() {
      current = queue.shift();
      if (!current) { socket.end(); return resolve(true); }
      send(current.cmd);
    }
    function onReady() { if (ready) return; ready = true; next(); }

    socket.on('data', chunk => {
      leftover += chunk.toString('binary');
      let idx;
      while ((idx = leftover.indexOf('\r\n')) >= 0) {
        const line = leftover.slice(0, idx);
        leftover = leftover.slice(idx + 2);
        const code = parseInt(line.slice(0, 3), 10);
        if (current === null) {
          if (code === 220) onReady();           // 服务器招呼语
          continue;
        }
        const final = line.length >= 4 && line[3] === ' ';
        if (isNaN(code) || !final) continue;      // 多行续行 / 非响应，忽略
        const ok = current.codes.includes(code) ||
          current.codes.some(c => Math.floor(code / 100) === Math.floor(c / 100));
        if (!ok) { socket.destroy(); return reject(new Error(`SMTP ${code}: ${line}`)); }
        setTimeout(next, 30);
      }
    });
    socket.on('error', reject);

    // 组装邮件（multipart/mixed，HTML 报告作附件）
    //
    // 【重要】所有正文/附件一律 base64 + 76 字符折行。
    // 原因：RFC 5321 规定 SMTP 单行不得超过 998 字节，而生成的报告 HTML 里
    // 含有超长单行（双语数据块可达 10 万+ 字符），直接以 8bit 原文投递会被
    // 服务端拒收或静默截断。base64 折行后天然满足行长限制，且不需要点填充。
    const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/.{76}/g, '$&\r\n');
    const boundary = '----=_Part_' + Date.now();
    let msg = '';
    msg += `From: ${from}\r\n`;
    msg += `To: ${to}\r\n`;
    msg += `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\n`;
    msg += `Date: ${new Date().toUTCString().replace('GMT', '+0000')}\r\n`;
    msg += `Message-ID: <${Date.now()}.${process.pid}@${String(from).split('@')[1] || 'localhost'}>\r\n`;
    msg += `MIME-Version: 1.0\r\n`;
    msg += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    msg += `--${boundary}\r\n`;
    msg += `Content-Type: text/plain; charset=UTF-8\r\n`;
    msg += `Content-Transfer-Encoding: base64\r\n\r\n`;
    msg += b64(text || 'A股次日候选池报告，详见附件 HTML。') + `\r\n\r\n`;
    if (htmlPath && fs.existsSync(htmlPath)) {
      const fname = path.basename(htmlPath);
      msg += `--${boundary}\r\n`;
      msg += `Content-Type: text/html; charset=UTF-8; name="${fname}"\r\n`;
      msg += `Content-Transfer-Encoding: base64\r\n`;
      msg += `Content-Disposition: attachment; filename="${fname}"\r\n\r\n`;
      msg += b64(fs.readFileSync(htmlPath)) + `\r\n\r\n`;
    }
    msg += `--${boundary}--\r\n`;

    // SMTP 透明化：行首的 "." 改为 ".."（base64 不会以 "." 开头，此处仅作兜底）
    msg = msg.replace(/(\r\n)\./g, '$1..');

    const queue = [
      { cmd: 'EHLO localhost', codes: [250] },
      { cmd: 'AUTH LOGIN', codes: [334] },
      { cmd: Buffer.from(user).toString('base64'), codes: [334] },
      { cmd: Buffer.from(pass).toString('base64'), codes: [235] },
      { cmd: `MAIL FROM:<${from}>`, codes: [250] },
      { cmd: `RCPT TO:<${to}>`, codes: [250, 251] },
      { cmd: 'DATA', codes: [354] },
      { cmd: msg + '\r\n.', codes: [250] },
      { cmd: 'QUIT', codes: [221, 250] },
    ];
    if (!ready) socket.on('secureConnect', () => {}); // 确保握手完成后再等 220
  });
}

async function pushEmail(subject, htmlPath, cfg) {
  const e = cfg.email || {};
  const sender = e.sender, auth = e.auth_code;
  if (!sender || !auth) return [false, '缺少 email sender/auth_code'];
  const host = e.smtp_host || 'smtp.163.com';
  const port = Number(e.smtp_port || 465);
  const receiver = e.receiver || sender;
  try {
    await smtpSend({ host, port, user: sender, pass: auth, from: sender, to: receiver, subject, text: 'A股次日候选池报告，详见附件 HTML。', htmlPath });
    return [true, `已发送至 ${receiver}`];
  } catch (ex) {
    return [false, String(ex && ex.message || ex)];
  }
}

// ---------- 统一入口 ----------
async function notify({ title, content, htmlPath, cfg }) {
  cfg = cfg || loadCfg();
  const res = [];
  if (cfg.wechat && (cfg.wechat.key || cfg.wechat.token)) {
    res.push(['wechat', await pushWechat(title, content, cfg)]);
  }
  if (cfg.email && cfg.email.sender && cfg.email.auth_code) {
    res.push(['email', await pushEmail(title, htmlPath, cfg)]);
  }
  if (!res.length) res.push(['none', [false, '未配置任何推送渠道（notify_config.json 为空）']]);
  return res;
}

module.exports = { loadCfg, notify, pushWechat, pushEmail };

// CLI：
//   node notify.js                      -> 自检，打印配置状态
//   node notify.js --send "标题" "正文"  -> 直接发一条（供 CI 在任务失败时告警用）
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--send') {
    const title = argv[1] || 'A股初筛告警';
    const content = argv[2] || '（无正文）';
    notify({ title, content }).then(res => {
      for (const [ch, [ok, info]] of res) {
        console.log(`[notify] ${ch}: ${ok ? 'OK' : '失败 ' + JSON.stringify(info)}`);
      }
      // 告警本身发不出去不应让 CI 再挂一次，恒定 0 退出
    }).catch(e => console.log('[notify] 异常:', e && e.message || e));
  } else {
    const c = loadCfg();
    console.log('wechat 配置:', !!(c.wechat && (c.wechat.key || c.wechat.token)));
    console.log('email  配置:', !!(c.email && c.email.sender && c.email.auth_code));
    console.log('notify_config.json 路径:', CFG_PATH);
  }
}
