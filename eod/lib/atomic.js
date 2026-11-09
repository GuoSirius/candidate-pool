'use strict';
/*
 * eod/lib/atomic.js —— JSON 落盘原子写 + 读取损坏保护（2026-11-09 评审 #9/#10）
 * ---------------------------------------------------------------------------
 * 问题：裸 writeFileSync 崩溃会留半截 JSON；读取 catch 把「损坏」与「不存在」
 * 一并吞成空默认 → 半截文件被静默重建，历史不可恢复。
 * 用法：
 *   atomicWriteJSON(file, data)          所有 JSON 落盘点统一走它
 *   readJSONSafe(file, fallback, log)    读取：ENOENT → fallback；损坏 → 隔离 .corrupt-* 后返回 fallback
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

/** 原子写 JSON：tmp 名含 pid + 随机后缀（并发进程不互踩同一 tmp）→ renameSync */
function atomicWriteJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 安全读 JSON：
 *  - 不存在（ENOENT）→ 返回 fallback（正常情况）；
 *  - 其他读取错误 → warn + fallback；
 *  - JSON 损坏 → 把原文件改名为 <file>.corrupt-<时间戳> 保留现场（可人工恢复），
 *    再返回 fallback —— 后续写入不会覆盖损坏原件。
 */
function readJSONSafe(file, fallback = null, log = () => {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return fallback;
    log(`[存档] 读取失败 ${file}: ${(e && e.message) || e}`);
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const corrupt = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, corrupt); } catch (e2) { /* 改名失败则仅告警 */ }
    log(`[存档] JSON 损坏已隔离：${file} → ${path.basename(corrupt)}（${(e && e.message) || e}）`);
    return fallback;
  }
}

module.exports = { atomicWriteJSON, readJSONSafe };
