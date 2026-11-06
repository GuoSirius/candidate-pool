'use strict';
/*
 * pulse/sources/announce.js —— 巨潮资讯公告（深市 column=szse；标题关键词过滤事件类公告）
 * 注意：httpPost 走 https，巨潮 query 接口同时支持 https://www.cninfo.com.cn。
 */
const { httpPost } = require('../lib/http');

function todayRange() {
  const d = new Date(Date.now() + 8 * 3600e3);
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const yesterday = new Date(d.getTime() - 24 * 3600e3);
  return `${iso(yesterday)}~${iso(d)}`;
}

async function fetchAnnouncements(limit, titleKeys) {
  const body = {
    pageNum: 1, pageSize: 50, column: 'szse', tabName: 'fulltext', plate: '', stock: '',
    searchkey: '', secid: '', category: '', trade: '', seDate: todayRange(),
    sortName: '', sortType: '', isHLtitle: 'true',
  };
  const txt = await httpPost('https://www.cninfo.com.cn/new/hisAnnouncement/query', body, {
    json: false, referer: 'http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  const j = JSON.parse(txt);
  const list = j.announcements || [];
  return list
    .filter((a) => titleKeys.some((k) => (a.announcementTitle || '').includes(k)))
    .slice(0, limit)
    .map((a) => {
      // 公司名一般在标题最前（"公司名：关于……的公告"）
      const name = (a.announcementTitle || '').split(/[：:]/)[0].trim();
      return {
        id: `cninfo-${a.announcementId}`,
        code: a.secCode || '', name,
        timeMs: a.announcementTime || 0,
        title: (a.announcementTitle || '').replace(/<[^>]+>/g, ''),
        url: a.adjunctUrl ? `http://static.cninfo.com.cn/${a.adjunctUrl}` : '',
      };
    });
}

module.exports = { fetchAnnouncements };
