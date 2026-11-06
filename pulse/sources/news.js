'use strict';
/*
 * pulse/sources/news.js —— 免费快讯源采集（新浪 / 东财 / 金十 / 华尔街见闻）
 * 统一输出：[{ id, source, timeMs, text, title, url }]
 * 已知不可用（v2 再攻）：
 *   - 财联社 nodeapi 全线 404、SSR 无数据（有签名反爬）
 *   - 韭研公社 XHR 需 token，SSR 不含列表（需浏览器渲染或逆向，专项处理）
 */
const httpGet = require('../../eod/lib/http').httpGet;

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const bj = (ms) => ms; // 时间统一存 epoch ms

// 新浪 7×24：result.data.feed.list[].rich_text / create_time
async function fetchSina(limit) {
  const j = await httpGet(`https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=${limit}&zhibo_id=152&tag_id=0`, {
    json: true, referer: 'https://finance.sina.com.cn/7x24/',
  });
  const list = (j && j.result && j.result.data && j.result.data.feed && j.result.data.feed.list) || [];
  return list.map((it) => {
    const text = strip(it.rich_text);
    const m = text.match(/^【(.+?)】/);
    return {
      id: `sina-${it.id || it.itemid || it.create_time}`,
      source: 'sina', timeMs: bj(Date.parse(`${it.create_time}+08:00`)),
      title: m ? m[1] : '', text,
      url: it.ext && it.ext.url || '',
    };
  }).filter((x) => x.text);
}

// 东财快讯：var ajaxResult={"rc":1,"LivesList":[...]}
async function fetchEastmoney(limit) {
  const txt = await httpGet(`https://newsapi.eastmoney.com/kuaixun/v1/getlist_101_ajaxResult_${limit}_1_.html`, {
    referer: 'https://kuaixun.eastmoney.com/',
  });
  const m = txt.match(/var\s+ajaxResult\s*=\s*(\{[\s\S]*\})/);
  if (!m) throw new Error('东财快讯格式变更');
  const j = JSON.parse(m[1]);
  const list = j.LivesList || [];
  return list.map((it) => {
    const text = strip(it.summary || it.title || '');
    const time = String(it.showTime || '').replace(/-/g, '/');
    return {
      id: `em-${it.newsid || it.id}`,
      source: 'em', timeMs: bj(time ? Date.parse(`${time}:00+08:00`.replace(/:00(\+08:00)$/, '$1')) : Date.now()),
      title: strip(it.title || ''), text,
      url: it.url_w || it.url_m || '',
    };
  }).filter((x) => x.text);
}

// 金十数据：flash_newest.js → var newest=[...]
async function fetchJin10(limit) {
  const txt = await httpGet('https://www.jin10.com/flash_newest.js', { referer: 'https://www.jin10.com/' });
  const m = txt.match(/var\s+newest\s*=\s*(\[[\s\S]*?\]);?\s*$/);
  if (!m) throw new Error('金十格式变更');
  const arr = JSON.parse(m[1]);
  return arr.slice(0, limit).map((it) => {
    const text = strip(it.title || (it.data && (it.data.content || it.data.title)) || '');
    // 金十只给 HH:mm，按今天（北京时间）拼
    const [H, M, S] = String(it.time || '00:00:00').split(':').map(Number);
    const d = new Date(Date.now() + 8 * 3600e3);
    d.setUTCHours(H || 0, M || 0, S || 0, 0);
    return {
      id: `jin10-${it.id}`,
      source: 'jin10', timeMs: bj(d.getTime() - 8 * 3600e3),
      title: '', text,
      url: '',
    };
  }).filter((x) => x.text);
}

// 华尔街见闻：apiv1/content/lives
async function fetchWscn(limit) {
  const j = await httpGet(`https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&client=pc&limit=${limit}`, {
    json: true, referer: 'https://wallstreetcn.com/',
  });
  const list = (j && j.data && j.data.items) || [];
  return list.map((it) => {
    const text = strip(it.content_text || it.title || '');
    return {
      id: `wscn-${it.id}`,
      source: 'wscn', timeMs: bj((it.display_time || 0) * 1000),
      title: strip(it.title || ''), text,
      url: it.uri || '',
    };
  }).filter((x) => x.text);
}

module.exports = { fetchSina, fetchEastmoney, fetchJin10, fetchWscn };
