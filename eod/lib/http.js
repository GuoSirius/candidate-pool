'use strict';
/*
 * eod/lib/http.js —— HTTP 抓取层（零第三方依赖，纯 Node 内建 https）
 * ---------------------------------------------------------------------------
 * 从 gen_candidates.js 的 httpGet 提取并泛化，保留了本项目已验证的三条关键经验：
 *
 *   1. **WAF 长退避**：腾讯接口在短时高频请求（尤其盘中）会返回一张反爬跳转页：
 *        <!DOCTYPE html><html><head><script>var i=location.href;var v=window.btoa? ...
 *      它是 HTTP 200，只能靠 JSON.parse 报错或嗅探正文发现。必须单独识别并走
 *      **秒级长退避**；几百毫秒的短退避拿到的仍是同一张拦截页，等于白重试。
 *      实测：状态码 501 + 跳转页正文，二者都查最稳。
 *
 *   2. **编码**：腾讯报价（qt.gtimg.cn）返回 **GBK**，中文股名直接按 UTF-8 解会乱码；
 *      腾讯 JSON 接口与东财接口返回 **UTF-8**。故解码编码必须显式指定、不可混用。
 *      注意 Node 的 Buffer.toString('gbk') 是**不支持的**（会抛 Unknown encoding），
 *      必须用 TextDecoder('gbk')，且需 try/catch 兜底（旧运行时可能无内置 GBK 表）。
 *
 *   3. **粘性端点**：见 makeSticky()。某条链路被 WAF 封掉后指针前移，
 *      后续标的直接走可用端点，不必每只票都去撞一次已知的墙。
 * ---------------------------------------------------------------------------
 */

const https = require('https');

// 用完整浏览器 UA：残缺 UA（如裸 "Mozilla/5.0"）本身就是风控指纹特征。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 命中拦截时的退避梯度（ms）：2s → 5s → 12s → 25s
const WAF_BACKOFF = [2000, 5000, 12000, 25000];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 按指定编码解码。enc: 'gbk' | 'utf8'。GBK 不可用时降级为 utf8（中文会乱码，但代码/数字仍可用）。 */
function decode(buf, enc) {
  if (enc === 'gbk') {
    try { return new TextDecoder('gbk').decode(buf); }
    catch (e) { return buf.toString('utf8'); }
  }
  return buf.toString('utf8');
}

/**
 * 判断响应正文是否是腾讯的反爬跳转页。
 * 只嗅探开头 300 字符，避免把正常的大 JSON 正文误判。
 */
function looksLikeWaf(txt) {
  const head = String(txt).slice(0, 300);
  return /<!DOCTYPE html|<html[\s>]/i.test(head) && /window\.btoa|location\.href/i.test(head);
}

/**
 * 通用 GET（带重试 + WAF 长退避）
 * @param {string} url
 * @param {object} opts
 *   - enc      'gbk' | 'utf8'  返回文本的解码方式（默认 utf8）
 *   - json     是否把返回解析为 JSON（默认 false，返回字符串）
 *   - retries  重试次数（默认 4）
 *   - timeout  单次超时 ms（默认 15000）
 *   - referer  Referer 头（默认 https://gu.qq.com/，腾讯行情系；东财用 https://quote.eastmoney.com/）
 *   - isWaf    自定义「这条响应算不算被拦截」判定（默认 looksLikeWaf）
 * @returns {Promise<any>} 文本或已解析的 JSON
 */
function httpGet(url, opts = {}) {
  const {
    enc = 'utf8', json = false, retries = 4, timeout = 15000,
    referer = 'https://gu.qq.com/', isWaf = null,
  } = opts;

  return new Promise(async (resolve, reject) => {
    let lastErr = null;
    let wafHits = 0;

    for (let i = 0; i < retries; i++) {
      if (i > 0) {
        // 被拦截 -> 长退避；普通网络抖动 -> 短退避
        const wait = (lastErr && lastErr.waf)
          ? WAF_BACKOFF[Math.min(wafHits - 1, WAF_BACKOFF.length - 1)]
          : 500 * i;
        await sleep(wait);
      }
      try {
        const { status, txt } = await new Promise((res, rej) => {
          const req = https.get(url, {
            timeout,
            headers: {
              'User-Agent': UA,
              Referer: referer,
              Accept: '*/*',
              'Accept-Language': 'zh-CN,zh;q=0.9',
            },
          }, (resp) => {
            const chunks = [];
            resp.on('data', (c) => chunks.push(c));
            resp.on('end', () => res({ status: resp.statusCode, txt: decode(Buffer.concat(chunks), enc) }));
          });
          req.on('error', rej);
          req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
        });

        // WAF 拦截：状态码判定 + 正文嗅探，两者都查
        const waf = (isWaf ? isWaf(txt, status) : false) || status === 501 || looksLikeWaf(txt);
        if (waf) {
          wafHits++;
          const e = new Error(`被接口反爬拦截（HTTP ${status}）`);
          e.waf = true;
          throw e;
        }
        if (status && status >= 400) throw new Error(`HTTP ${status}`);

        if (!json) return resolve(txt.trim());
        const body = txt.trim();
        try { return resolve(JSON.parse(body)); }
        catch (e) {
          // 兼容 JSONP 包裹：name({...});
          const m = body.match(/^[a-zA-Z0-9_$.]+\(([\s\S]*)\);?$/);
          if (m) { try { return resolve(JSON.parse(m[1])); } catch (e2) { /* 落到下面报错 */ } }
          throw new Error('JSON 解析失败: ' + body.slice(0, 120));
        }
      } catch (e) {
        lastErr = e;
      }
    }
    reject(lastErr || new Error('httpGet 失败'));
  });
}

/**
 * 并发受限的 map（本文件自带，避免与 gen_candidates.js 交叉依赖）
 * 注意：不吞异常——返回 { __error } 占位，调用方需自行判定。
 */
async function mapLimit(items, limit, fn) {
  const res = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = [];
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      while (i < items.length) {
        const idx = i++;
        try { res[idx] = await fn(items[idx], idx); }
        catch (e) { res[idx] = { __error: String((e && e.message) || e) }; }
      }
    })());
  }
  await Promise.all(workers);
  return res;
}

/**
 * 粘性端点选择器。
 * 场景：同一份数据有多个镜像链路（如日K / 行业映射），其中某条被 WAF 封掉。
 * 用法：
 *   const pick = makeSticky(['a', 'b', 'c']);
 *   for (;;) { const ep = pick.cur(); try { ...; break; } catch { pick.next(); } }
 * 记住当前可用下标，后续调用直接从可用链路开始。
 */
function makeSticky(endpoints) {
  let idx = 0;
  return {
    cur() { return endpoints[idx]; },
    index() { return idx; },
    /** 前移到下一条链路，返回是否还有可用链路 */
    next() { idx = (idx + 1) % endpoints.length; return true; },
    /** 逐条尝试：fn(ep, i) 抛错则换下一条；全部失败抛最后一次错误 */
    async tryAll(fn, onSwitch) {
      let lastErr = null;
      for (let step = 0; step < endpoints.length; step++) {
        const i = (idx + step) % endpoints.length;
        const ep = endpoints[i];
        try {
          const out = await fn(ep, i);
          if (i !== idx) { idx = i; if (onSwitch) onSwitch(ep); }
          return out;
        } catch (e) {
          lastErr = e;
          // 数据层问题（如字段缺失）换链路也没用，直接抛出，避免无意义重试
          if (e && e.fatal) throw e;
        }
      }
      throw lastErr || new Error('全部链路均不可用');
    },
  };
}

/** 带前导零的代码：toCode('sh', 600519) -> 'sh600519' */
function toCode(prefix, n) { return prefix + String(n).padStart(6, '0'); }

module.exports = { httpGet, mapLimit, makeSticky, decode, looksLikeWaf, toCode, sleep, UA };
