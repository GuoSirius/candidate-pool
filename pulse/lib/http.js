'use strict';
/*
 * pulse/lib/http.js —— 抓取层：复用 eod/lib/http.js 已验证的 GET（重试+WAF 退避+GBK），
 * 这里只补充它没有的 POST（巨潮等表单接口）。
 */
const https = require('https');
const { UA, sleep } = require('../../eod/lib/http');

/** 通用 POST。data 为对象，json=true 发 JSON，否则 x-www-form-urlencoded。返回文本。 */
async function httpPost(url, data, opts = {}) {
  const { json = true, timeout = 15000, retries = 2, referer = new URL(url).origin, headers = {} } = opts;
  const body = json ? JSON.stringify(data) : new URLSearchParams(data).toString();
  const contentType = json ? 'application/json' : 'application/x-www-form-urlencoded; charset=UTF-8';
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    if (i > 0) await sleep(500 * i);
    try {
      return await new Promise((res, rej) => {
        const u = new URL(url);
        const payload = Buffer.from(body, 'utf8');
        const req = https.request({
          hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
          timeout, headers: {
            'User-Agent': UA, Referer: referer, Origin: u.origin,
            'Content-Type': contentType, 'Content-Length': payload.length, ...headers,
          },
        }, (resp) => {
          const chunks = [];
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () => {
            const txt = Buffer.concat(chunks).toString('utf8');
            if (resp.statusCode >= 400) return rej(new Error(`HTTP ${resp.statusCode}`));
            res(txt);
          });
        });
        req.on('error', rej);
        req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
        req.write(payload); req.end();
      });
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('httpPost 失败');
}

module.exports = { httpPost };
