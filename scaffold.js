'use strict';
/*
 * scaffold.js —— 首次运行脚手架（Phase 1）
 * ---------------------------------------------------------------------------
 * 解决什么问题：
 *   「拉代码运行」时仓库里什么都有；但装成 npm 包（或 npx）后，工作目录是空的，
 *   首跑会直接因为缺 candidates.json 报错，或者跑出来「全市场塌成一个未分类」。
 *   本模块在入口处做一次幂等的补齐，让空目录也能跑起来。
 *
 * 三条不可动摇的规则（都是为了向后兼容）：
 *   1. **只创建缺失的目录，绝不覆盖任何已存在的文件**。
 *      老仓库里已有的 candidates.json / notify_config.json / db/.env 一个字都不会动。
 *   2. **不生成任何含凭据的配置文件**。
 *      notify_config.json / db/.env 一旦被写入占位值，程序会从「未配置 → 跳过」
 *      变成「配了但值是假的 → 真的去发/去连」，行为静默改变。这两份**只提示不创建**。
 *   3. 重复调用零副作用（幂等），失败也只降级为提示、不阻断主流程。
 *
 * 补什么（全部可从包内模板/资产取得）：
 *   <HOME>/data、reports、eod/data、eod/reports、db        目录
 *   <HOME>/candidates.json    ← 包内 candidates.example.json（硬阻塞项，缺它直接报错）
 *   eod/data/industry-map.json 不复制 —— eod/lib/sector.js 会直接回退读包内那份种子
 *
 * 不补什么（只打印提示，交给用户决定）：
 *   notify_config.json  ← notify_config.example.json（推送凭据）
 *   db/.env            ← db/.env.example（Cloudflare D1 凭据）
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

/** 需要在工作目录里存在的目录（缺则建） */
function dirs() {
  return [
    paths.dataDir(),
    paths.reportsDir(),
    paths.eodDataDir(),
    paths.eodReportsDir(),
    path.dirname(paths.localDb()),
  ];
}

/**
 * 播种文件：目标 ← 包内模板。
 * 只放「缺失即硬报错」的项；candidates.json 是唯一一个。
 */
function seeds() {
  return [
    {
      to: paths.candidatesFile(),
      from: paths.codeAsset('candidates.example.json'),
      label: '候选观察池',
      required: true,
      note: '来自示例模板（52 只，覆盖 26 个行业）。建议用 `node build_universe.js` 按自己的市值门槛重建。',
    },
  ];
}

/** 只提示、不创建的配置文件（含凭据，占位值会改变程序行为） */
function hints() {
  return [
    {
      to: paths.notifyConfigFile(),
      from: paths.codeAsset('notify_config.example.json'),
      label: '微信 / 邮件推送配置',
      when: '需要跑完自动推送时',
    },
    {
      to: paths.dbEnvFile(),
      from: paths.codeAsset('db', '.env.example'),
      label: 'Cloudflare D1 凭据（写入线上库用）',
      when: '需要把结果同步到网页/D1 时',
    },
  ];
}

/** 是否处于「被当作依赖安装」的目录里（node_modules / npx 缓存） */
function looksInstalled(dir = paths.home()) {
  return /[\\/]node_modules[\\/]/.test(dir + path.sep);
}

/**
 * 补齐工作目录。幂等、不覆盖、不抛错（内部错误降级为 warning）。
 *
 * @param {object} [o]
 * @param {boolean} [o.force]  即使没有任何缺失也返回完整报告（`--init` 用）
 * @returns {{home:string, source:string, relocated:boolean, installed:boolean,
 *            createdDirs:string[], createdFiles:Array, hints:Array, missing:Array}}
 */
function ensureWorkspace({ force = false } = {}) {
  const home = paths.home();
  const createdDirs = [];
  const createdFiles = [];
  const missing = [];

  for (const d of dirs()) {
    if (fs.existsSync(d)) continue;
    try {
      fs.mkdirSync(d, { recursive: true });
      createdDirs.push(d);
    } catch (e) {
      missing.push({ path: d, reason: String((e && e.message) || e) });
    }
  }

  for (const s of seeds()) {
    if (fs.existsSync(s.to)) continue;
    if (!fs.existsSync(s.from)) {
      // 包内模板都不在（例如被 --ignore-files 裁掉）→ 不阻断，交给上游报错
      missing.push({ path: s.to, reason: `包内模板缺失：${s.from}` });
      continue;
    }
    try {
      fs.copyFileSync(s.from, s.to);
      createdFiles.push(s);
    } catch (e) {
      missing.push({ path: s.to, reason: String((e && e.message) || e) });
    }
  }

  return {
    home,
    source: paths.homeSource(),
    relocated: paths.isRelocated(),
    installed: looksInstalled(home),
    createdDirs,
    createdFiles,
    hints: hints().filter((h) => !fs.existsSync(h.to)),
    missing,
    force,
  };
}

/** 把报告渲染成若干行日志（没有任何变化时返回空数组，保持静默） */
function renderReport(r) {
  const lines = [];
  const changed = r.createdDirs.length + r.createdFiles.length;
  if (!changed && !r.missing.length) return lines;

  lines.push('── 首次运行脚手架 ──');
  for (const d of r.createdDirs) lines.push(`  新建目录 ${d}`);
  for (const f of r.createdFiles) {
    lines.push(`  创建文件 ${f.to}`);
    lines.push(`          ↳ ${f.label}：${f.note}`);
  }
  for (const m of r.missing) lines.push(`  ⚠ 未能创建 ${m.path}（${m.reason}）`);

  if (r.installed) {
    lines.push('');
    lines.push('  ⚠ 当前工作目录在 node_modules 里 —— 产物会随重装/npx 清缓存一起丢失。');
    lines.push('    建议显式指定工作目录，例如：');
    lines.push('      npx candidate-pool --cwd ~/my-pool');
    lines.push('      # 或 export CANDIDATE_POOL_HOME=~/my-pool');
  }
  return lines;
}

/** 提示可选配置（只在用户显式 `--init` 时打印，避免日常刷屏） */
function renderHints(r) {
  if (!r.hints.length) return [];
  const lines = ['', '── 可选配置（未自动创建，需要时手动复制）──'];
  for (const h of r.hints) {
    lines.push(`  ${h.label}（${h.when}）：`);
    lines.push(`    cp "${h.from}" "${h.to}"`);
  }
  return lines;
}

/**
 * 入口处调用：补齐工作目录并按需打印。
 * 日常运行只在实际创建了东西时才有输出（正常情况下完全静默）。
 *
 * @param {object} [o]
 * @param {(s:string)=>void} [o.log]  日志函数（默认 console.log）
 * @param {boolean} [o.init]          显式 `--init`：无条件打印报告 + 可选配置提示
 */
function autoInit({ log = console.log, init = false } = {}) {
  let r;
  try {
    r = ensureWorkspace({ force: init });
  } catch (e) {
    log(`⚠ 工作目录初始化失败（已忽略，继续运行）：${(e && e.message) || e}`);
    return null;
  }
  // `--init` 是「我想确认一下环境」的显式请求 → 无论有没有变化都要有回音；
  // 日常运行则完全静默（只在实际创建了东西时出声）。
  if (init) {
    const report = renderReport(r);
    if (report.length) for (const l of report) log(l);
    else log(`── 工作目录已就绪（无需创建任何文件）──  ${r.home}  [${r.source}]`);
    for (const l of renderHints(r)) log(l);
    return r;
  }
  for (const l of renderReport(r)) log(l);
  return r;
}

module.exports = { ensureWorkspace, autoInit, renderReport, renderHints, dirs, seeds, hints, looksInstalled };
