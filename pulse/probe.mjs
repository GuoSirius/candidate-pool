'use strict';
/*
 * pulse/probe.mjs
 * 数据源探针：实测各免费源可达性与字段规整度。用法：node pulse/probe.mjs
 */
const TIMEOUT = 12000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function tryFetch(name, url, opt = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: opt.referer || new URL(url).origin, ...(opt.headers || {}) },
      method: opt.method || 'GET',
      body: opt.body,
    });
    const text = await res.text();
    console.log(`[${name}] HTTP ${res.status} len=${text.length}`);
    return { ok: res.ok, text };
  } catch (e) {
    console.log(`[${name}] FAIL ${e.name}: ${String(e.cause?.message || e.message).slice(0, 120)}`);
    return { ok: false, text: '' };
  } finally { clearTimeout(t); }
}

const probes = {
  // 1. 新浪 7x24
  async sina() {
    const { ok, text } = await tryFetch('sina7x24', 'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=5&zhibo_id=152&tag_id=0');
    if (!ok) return;
    const j = JSON.parse(text);
    const list = j?.result?.data?.feed?.list || [];
    console.log(`  items=${list.length} sample=${JSON.stringify((list[0] && { t: list[0].create_time, x: (list[0].rich_text || '').slice(0, 50) }))}`);
  },
  // 2. 东财快讯 listapi
  async emNews() {
    const url = 'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&order=1&needInteractData=0&page_index=1&page_size=5&fields=code,showTime,title,summary';
    const { ok, text } = await tryFetch('em7x24', url);
    if (!ok) return;
    const j = JSON.parse(text);
    const list = j?.data?.list || [];
    console.log(`  items=${list.length} sample=${JSON.stringify(list[0] && { t: list[0].showTime, x: (list[0].summary || list[0].title || '').slice(0, 50) })}`);
  },
  // 3. 财联社电报（签名算法 md5(sha1(sorted-params))）
  async cls() {
    const crypto = await import('node:crypto');
    const params = { app: 'CailianpressWeb', category: '', last_time: '', os: 'web', refresh_type: '1', rn: '10', sv: '8.4.6' };
    const qs = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const sign = crypto.createHash('md5').update(crypto.createHash('sha1').update(qs).digest('hex')).digest('hex');
    const url = `https://www.cls.cn/nodeapi/updateTelegraphList?${qs}&sign=${sign}`;
    const { ok, text } = await tryFetch('cls7x24', url, { referer: 'https://www.cls.cn/telegraph' });
    if (!ok) return;
    const j = JSON.parse(text);
    const list = j?.data?.telegraph || [];
    console.log(`  items=${list.length} sample=${JSON.stringify(list[0] && { t: list[0].ctime, x: (list[0].content || '').replace(/<[^>]+>/g, '').slice(0, 50) })}`);
  },
  // 4. 金十数据 flash
  async jin10() {
    const { ok, text } = await tryFetch('jin10', 'https://www.jin10.com/flash_newest.js', { referer: 'https://www.jin10.com/' });
    if (!ok) return;
    const mjs = text.match(/var\s+newest\s*=\s*(\[[\s\S]*?\]);?\s*$/);
    const arr = mjs ? JSON.parse(mjs[1]) : null;
    if (!arr) { console.log('  parse FAIL, head=' + text.slice(0, 100)); return; }
    console.log(`  items=${arr.length} sample=${JSON.stringify(arr[0] && { t: arr[0].time, x: String(arr[0].title || arr[0].data?.content || '').replace(/<[^>]+>/g, '').slice(0, 50) })}`);
  },
  // 5. 华尔街见闻 lives
  async wscn() {
    const { ok, text } = await tryFetch('wscn', 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&client=pc', { referer: 'https://wallstreetcn.com/' });
    if (!ok) return;
    const j = JSON.parse(text);
    const list = j?.data?.items || [];
    console.log(`  items=${list.length} sample=${JSON.stringify(list[0] && { t: list[0].display_time, x: String(list[0].content_text || list[0].title || '').slice(0, 50) })}`);
  },
  // 6. 东财板块行情+主力资金流（行业 m:90+t:1 / 概念 m:90+t:2）
  async emBoards() {
    const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f3,f12,f14,f62,f104,f105,f128,f136';
    const { ok, text } = await tryFetch('emBoards', url);
    if (!ok) return;
    const j = JSON.parse(text);
    const list = j?.data?.diff || [];
    console.log(`  total=${j?.data?.total} sample=${JSON.stringify(list[0])}`);
  },
  // 7. 巨潮公告
  async cninfo() {
    const body = 'pageNum=1&pageSize=5&column=szse&tabName=fulltext&plate=&stock=&searchkey=&secid=&category=&trade=&seDate=2026-11-05~2026-11-06&sortName=&sortType=&isHLtitle=true';
    const { ok, text } = await tryFetch('cninfo', 'http://www.cninfo.com.cn/new/hisAnnouncement/query', {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!ok) return;
    const j = JSON.parse(text);
    const list = j?.announcements || [];
    console.log(`  total=${j?.totalAnnouncement} sample=${JSON.stringify(list[0] && { t: list[0].announcementTime, x: (list[0].announcementTitle || '').slice(0, 50) })}`);
  },
  // 8. 韭研公社用户页（SPA，找 API 线索）
  async jygs() {
    const { ok, text } = await tryFetch('jygs-page', 'https://www.jiuyangongshe.com/u/4df747be1bf143a998171ef03559b517');
    if (!ok) return;
    const apis = [...new Set((text.match(/["'](\/action[^"']*|\/a\/[^"']*|\/api[^"']*)["']/g) || []).slice(0, 10))];
    console.log(`  api hints: ${apis.join(', ') || '(none in html)'}`);
    console.log(`  has waf: ${/acw_sc__v2|aliyun|waf/i.test(text)}, head=${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  },
};

(async () => {
  for (const [name, fn] of Object.entries(probes)) {
    try { await fn(); } catch (e) { console.log(`[${name}] ERROR ${e.message}`); }
  }
})();
