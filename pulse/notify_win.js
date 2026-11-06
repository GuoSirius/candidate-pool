'use strict';
/*
 * pulse/notify_win.js —— 异动通知
 * Windows：WinRT Toast（PowerShell 调用，零依赖）+ console；其他平台仅 console。
 * 规则：没有新异动绝不打扰（调用方 diff 后才有 event）。
 */
const { spawn } = require('child_process');

function toastPS(title, body) {
  // -EncodedCommand 传参，规避引号转义问题（UTF-16LE base64）
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $xml.GetElementsByTagName('text')
$t.Item(0).AppendChild($xml.CreateTextNode('${title.replace(/'/g, "''")}')) | Out-Null
$t.Item(1).AppendChild($xml.CreateTextNode('${body.replace(/'/g, "''")}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show($toast)`;
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); // 失败静默，console 已有输出
}

/** 统一通知入口：Windows = Toast + console，其他 = console */
function notify(title, body) {
  console.log(`[pulse:notify] ${title} — ${body}`);
  if (process.platform === 'win32') toastPS(title, body);
}

module.exports = { notify };
