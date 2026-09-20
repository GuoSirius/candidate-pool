/**
 * commitlint 配置（CommonJS，根 package.json 为 CJS 故用 .cjs）。
 * 显式声明 Conventional Commits 的常规 type，与 changelog.config.cjs 的 types
 * 保持同名同义，确保 CHANGELOG 分组与提交规范一致。
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 仅允许以下常规 type（可见、可维护）
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // 缺陷修复
        'docs', // 文档
        'style', // 代码格式（不影响逻辑）
        'refactor', // 重构
        'perf', // 性能优化
        'test', // 测试
        'build', // 构建/依赖
        'ci', // 持续集成
        'chore', // 杂项维护
        'revert', // 回滚
      ],
    ],
    'type-case': [2, 'always', 'lower-case'], // type 强制小写
    'subject-case': [2, 'always', 'lower-case'], // subject 强制小写
    'subject-empty': [2, 'never'], // subject 不能为空
    'subject-full-stop': [2, 'never', '.'], // 禁止句末点号
    'header-max-length': [2, 'always', 100], // header 限长
  },
};
