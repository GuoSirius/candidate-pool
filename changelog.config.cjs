/**
 * changelogen 配置 —— 文件名必须是 changelog.config.*（不是 changelogen.config.js）。
 * changelogen 内部 loadConfig({ name: 'changelog' })，只会找 changelog.config.*。
 *
 * types 必须是 Record<type名, { title, semver }> 格式（不是数组）。
 * title 为中文语义分组，与 commitlint 的 11 类 type 一一对应。
 *
 * 根 package.json 为 CommonJS，故用 .cjs + module.exports。
 */
module.exports = {
  // 仓库信息会展示在 CHANGELOG 顶部链接
  repo: {
    provider: 'github',
    repo: 'GuoSirius/candidate-pool',
  },
  types: {
    feat: { title: '🚀 新功能 (Features)', semver: 'minor' },
    fix: { title: '🐛 缺陷修复 (Bug Fixes)', semver: 'patch' },
    perf: { title: '⚡ 性能优化 (Performance)', semver: 'patch' },
    refactor: { title: '♻️ 代码重构 (Refactors)', semver: 'patch' },
    docs: { title: '📚 文档 (Documentation)', semver: 'patch' },
    test: { title: '🧪 测试 (Tests)', semver: 'patch' },
    build: { title: '🔧 构建 (Build)', semver: 'patch' },
    ci: { title: '⚙️ 持续集成 (CI)', semver: 'patch' },
    chore: { title: '📦 杂项维护 (Chores)', semver: 'patch' },
    style: { title: '🎨 代码格式 (Style)', semver: 'patch' },
    revert: { title: '⏪ 回滚 (Reverts)', semver: 'patch' },
  },
};
