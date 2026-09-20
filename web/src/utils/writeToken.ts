import { ref } from 'vue';

/**
 * 写接口共享令牌（前端侧存储）。
 *
 * 站点是公开可访问的，写接口靠 Worker 侧配置的 `WRITE_TOKEN` 挡一层；
 * 前端把同一个令牌存 localStorage，请求时以 `x-write-token` 头带上。
 *
 * 为什么用 ref 而不是普通函数：顶栏的「写权限」控件与详情页的编辑区需要联动，
 * 存成一个模块级响应式变量，改完两边同时刷新，不用事件总线。
 *
 * 安全边界：令牌只存在本机浏览器，不进代码库、不进构建产物；换设备需重填。
 */
const KEY = 'cp:write-token';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    // 隐私模式 / 禁用存储：退化为「本次会话内存里有效」
    return '';
  }
}

/** 当前写令牌（空串 = 未设置）。 */
export const writeToken = ref<string>(read());

/** 保存令牌；传空串等价于清除。 */
export function setWriteToken(value: string): void {
  const token = value.trim();
  writeToken.value = token;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* 存储不可用时仅内存生效，不阻断交互 */
  }
}

export function clearWriteToken(): void {
  setWriteToken('');
}
