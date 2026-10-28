// AULA F87 PRO 按键矩阵与 4 字节键值编码（来自 OemDrv.exe 逆向，见 docs/PROTOCOL.md 第 6 节）
// 纯数据 + 编解码，没有 UI 和设备访问，可在 Node 里测试。名称的英文写在各表的 en 字段（i18n.js 的 L() 取用）。
//
// 每层 128 个槽位 × 4 字节 = 512 字节。键值字节顺序 [b0 类型, b1, b2, b3]。
// 官方程序 keyinfo_to_hardware_code（0x48C780）返回一个 uint32，小端写入矩阵。

import { t, L } from './i18n.js';

export const MATRIX_LEN = 128;
export const MATRIX_SIZE = MATRIX_LEN * 4;
export const SIG_SLOT = MATRIX_LEN - 1;          // 官方 FillMatrix 在 CRC=1 时写 0xA55A0000
export const SIG_BYTES = [0x00, 0x00, 0x5A, 0xA5];

// 层号 = 官方界面上标签页的顺序（0x42076E：tc_kb5..tc_kb8，按 LayerMask 位跳过）
export const LAYERS = [
  { layer: 0, name: '默认层', en: 'Default layer' },
  { layer: 1, name: 'FN1 层', en: 'FN1 layer' },
  { layer: 2, name: 'FN2 层', en: 'FN2 layer' },
  { layer: 3, name: 'Tap 层', en: 'Tap layer' },
];

// KB.ini [KEY] 顺序（K1..K87）和矩阵槽位（每行最后一个数）
export const KEYS = [
  ['Esc', 0], ['F1', 12], ['F2', 18], ['F3', 24], ['F4', 30], ['F5', 36], ['F6', 42], ['F7', 48], ['F8', 54],
  ['F9', 60], ['F10', 66], ['F11', 72], ['F12', 78], ['`', 1], ['1', 7], ['2', 13], ['3', 19], ['4', 25],
  ['5', 31], ['6', 37], ['7', 43], ['8', 49], ['9', 55], ['0', 61], ['-', 67], ['=', 73], ['Backspace', 79],
  ['PrtSc', 84], ['ScrLk', 90], ['Pause', 96], ['Tab', 2], ['Q', 8], ['W', 14], ['E', 20], ['R', 26], ['T', 32],
  ['Y', 38], ['U', 44], ['I', 50], ['O', 56], ['P', 62], ['[', 68], [']', 74], ['\\', 80], ['Delete', 86],
  ['Insert', 85], ['Home', 91], ['PgUp', 97], ['CapsLock', 3], ['A', 9], ['S', 15], ['D', 21], ['F', 27],
  ['G', 33], ['H', 39], ['J', 45], ['K', 51], ['L', 57], [';', 63], ["'", 69], ['Enter', 81], ['End', 92],
  ['PgDn', 98], ['LShift', 4], ['Z', 10], ['X', 16], ['C', 22], ['V', 28], ['B', 34], ['N', 40], ['M', 46],
  [',', 52], ['.', 58], ['/', 64], ['RShift', 82], ['Up', 94], ['RCtrl', 83], ['LCtrl', 5], ['LWin', 11],
  ['LAlt', 17], ['Space', 35], ['RAlt', 53], ['FN', 59], ['App', 65], ['Left', 89], ['Down', 95], ['Right', 101],
].map(([name, slot], i) => ({ k: i + 1, name, slot }));
export const SLOT = Object.fromEntries(KEYS.map(k => [k.name, k.slot]));

// 官方界面不让改的键（只是界面限制，0x419860）：
// KeyNotToSet=1..12 是 [KEY] 的 0 基序号 → K2..K13 = F1..F12；FnNotToSet 默认 1 → Fn 键。所有层都生效。
export const OFFICIAL_LOCKED = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'FN']);

// ---- 键盘键（类型 0x00）----

export const MODS = ['LCtrl', 'LShift', 'LAlt', 'LWin', 'RCtrl', 'RShift', 'RAlt', 'RWin'];

// HID 键盘用法码 → 名称。范围与官方 VK→HID 表（0x607290，115 项）一致
export const HID_NAMES = (() => {
  const n = {};
  for (let i = 0; i < 26; i++) n[0x04 + i] = String.fromCharCode(65 + i);
  '1234567890'.split('').forEach((c, i) => { n[0x1E + i] = c; });
  Object.assign(n, {
    0x28: 'Enter', 0x29: 'Esc', 0x2A: 'Backspace', 0x2B: 'Tab', 0x2C: 'Space', 0x2D: '-', 0x2E: '=',
    0x2F: '[', 0x30: ']', 0x31: '\\', 0x32: '#(ISO)', 0x33: ';', 0x34: "'", 0x35: '`', 0x36: ',', 0x37: '.',
    0x38: '/', 0x39: 'CapsLock', 0x46: 'PrtSc', 0x47: 'ScrLk', 0x48: 'Pause', 0x49: 'Insert', 0x4A: 'Home',
    0x4B: 'PgUp', 0x4C: 'Delete', 0x4D: 'End', 0x4E: 'PgDn', 0x4F: 'Right', 0x50: 'Left', 0x51: 'Down',
    0x52: 'Up', 0x53: 'NumLock', 0x54: 'Num /', 0x55: 'Num *', 0x56: 'Num -', 0x57: 'Num +', 0x58: 'Num Enter',
    0x62: 'Num 0', 0x63: 'Num .', 0x64: '\\(ISO)', 0x65: 'App', 0x68: 'F13',
    0x85: 'Num ,', 0x87: 'Ro', 0x88: 'かな', 0x89: '¥', 0x8A: '変換', 0x8B: '無変換', 0x90: '한/영', 0x91: '한자',
  });
  for (let i = 0; i < 12; i++) n[0x3A + i] = 'F' + (i + 1);
  for (let i = 0; i < 9; i++) n[0x59 + i] = 'Num ' + (i + 1);
  MODS.forEach((m, i) => { n[0xE0 + i] = m; });
  return n;
})();

// 浏览器 KeyboardEvent.code → HID 用法码（按键页“按下要设置的键”录入用）。
// 只收 HID_NAMES 里有的键；0x32 #(ISO) 没有对应的 code。Win 键、Ctrl+Alt+Del 等浏览器收不到，界面要提供手动选择
export const CODE_TO_HID = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) m['Key' + String.fromCharCode(65 + i)] = 0x04 + i;
  '1234567890'.split('').forEach((c, i) => { m['Digit' + c] = 0x1E + i; });
  for (let i = 0; i < 12; i++) m['F' + (i + 1)] = 0x3A + i;
  for (let i = 0; i < 9; i++) m['Numpad' + (i + 1)] = 0x59 + i;
  Object.assign(m, {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2A, Tab: 0x2B, Space: 0x2C, Minus: 0x2D, Equal: 0x2E,
    BracketLeft: 0x2F, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
    Insert: 0x49, Home: 0x4A, PageUp: 0x4B, Delete: 0x4C, End: 0x4D, PageDown: 0x4E,
    ArrowRight: 0x4F, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56, NumpadAdd: 0x57,
    NumpadEnter: 0x58, Numpad0: 0x62, NumpadDecimal: 0x63, IntlBackslash: 0x64, ContextMenu: 0x65, F13: 0x68,
    NumpadComma: 0x85, IntlRo: 0x87, KanaMode: 0x88, IntlYen: 0x89, Convert: 0x8A, NonConvert: 0x8B,
    Lang1: 0x90, Lang2: 0x91,
    ControlLeft: 0xE0, ShiftLeft: 0xE1, AltLeft: 0xE2, MetaLeft: 0xE3, OSLeft: 0xE3,
    ControlRight: 0xE4, ShiftRight: 0xE5, AltRight: 0xE6, MetaRight: 0xE7, OSRight: 0xE7,
  });
  return m;
})();

// 修饰键的 code → MODS 位图里的位
export const modBit = code => {
  const u = CODE_TO_HID[code];
  return u >= 0xE0 && u <= 0xE7 ? 1 << (u - 0xE0) : 0;
};

// 手动选择 → action。选的键本身是修饰键时按出厂的写法存成位图（例如 LShift = 00 02 00 00）
export function keyAction(key, mods = 0) {
  if (key >= 0xE0 && key <= 0xE7) return { kind: 'mods', mods: mods | (1 << (key - 0xE0)) };
  if (key) return { kind: 'key', key, mods };
  return mods ? { kind: 'mods', mods } : null;
}

// 录入结果 → action：按住的修饰键 + 最后按下的普通键；没有普通键就是“单独的修饰键”
export function recordedAction(mods, code) {
  if (!code) return keyAction(0, mods);
  const key = CODE_TO_HID[code];
  if (key === undefined || modBit(code)) return null;
  return keyAction(key, mods);
}

// ---- 多媒体（类型 0x02，用法码 = b2<<8 | b3）----
// official: 官方键盘“按键指派 → 多媒体”页的 14 项（0x41E8FA），顺序同官方
export const MEDIA = [
  { usage: 0x0CD, name: '播放/暂停', en: 'Play/Pause', official: true },
  { usage: 0x0E2, name: '静音', en: 'Mute', official: true },
  { usage: 0x0B7, name: '停止播放', en: 'Stop', official: true },
  { usage: 0x0B6, name: '上一曲', en: 'Previous track', official: true },
  { usage: 0x0B5, name: '下一曲', en: 'Next track', official: true },
  { usage: 0x0E9, name: '音量 +', en: 'Volume +', official: true },
  { usage: 0x0EA, name: '音量 -', en: 'Volume -', official: true },
  { usage: 0x223, name: '浏览器', en: 'Browser home', official: true },
  { usage: 0x192, name: '计算器', en: 'Calculator', official: true },
  { usage: 0x18A, name: '邮件', en: 'Email', official: true },
  { usage: 0x194, name: '我的电脑', en: 'My Computer', official: true },
  { usage: 0x22A, name: '收藏夹', en: 'Favorites', official: true },
  { usage: 0x06F, name: '屏幕亮度 +', en: 'Screen brightness +', official: true },
  { usage: 0x070, name: '屏幕亮度 -', en: 'Screen brightness -', official: true },
  // 编码函数里有、但键盘菜单没列出的
  { usage: 0x183, name: '播放器', en: 'Media player', official: false },
  { usage: 0x221, name: '搜索', en: 'Search', official: false },
  { usage: 0x224, name: '浏览器后退', en: 'Browser back', official: false },
  { usage: 0x225, name: '浏览器前进', en: 'Browser forward', official: false },
  { usage: 0x226, name: '浏览器停止', en: 'Browser stop', official: false },
  { usage: 0x227, name: '浏览器刷新', en: 'Browser refresh', official: false },
];

// ---- 鼠标（类型 0x01）：[01, 按键号, 连击次数, 间隔] ----
// 按键号 1 左 2 右 3 中 4 后退 5 前进；8/9 滚轮。键盘设备上官方会把 0x14/0x15 互换（0x48C80D），
// 所以“前进”= 5、“后退”= 4，与 HID 按键 4/5 的惯例一致。
export const MOUSE = [
  { bytes: [0x01, 0x01, 0x01, 0x00], name: '左键', en: 'Left button', official: true },
  { bytes: [0x01, 0x02, 0x01, 0x00], name: '右键', en: 'Right button', official: true },
  { bytes: [0x01, 0x03, 0x01, 0x00], name: '中键', en: 'Middle button', official: true },
  { bytes: [0x01, 0x05, 0x01, 0x00], name: '前进', en: 'Forward', official: true },
  { bytes: [0x01, 0x04, 0x01, 0x00], name: '后退', en: 'Back', official: true },
  { bytes: [0x01, 0x01, 0x02, 0x00], name: '左键双击', en: 'Left double-click', official: false },
  { bytes: [0x01, 0x01, 0x03, 0x32], name: '左键三连发', en: 'Left triple-click', official: false },
  { bytes: [0x01, 0x08, 0x00, 0x00], name: '滚轮上', en: 'Scroll up', official: false },
  { bytes: [0x01, 0x09, 0x00, 0x00], name: '滚轮下', en: 'Scroll down', official: false },
];
const MOUSE_BUTTONS = {
  1: { name: '左键', en: 'Left' }, 2: { name: '右键', en: 'Right' }, 3: { name: '中键', en: 'Middle' },
  4: { name: '后退', en: 'Back' }, 5: { name: '前进', en: 'Forward' },
};

// ---- 常用命令（官方“常用命令”页 13 项，0x41F07C；编码见 0x48C9F2 类型 6 分支）----
export const COMMANDS = [
  { bytes: [0x00, 0x04, 0x3D, 0x00], name: '关闭窗口', en: 'Close window' },     // Alt+F4
  { bytes: [0x00, 0x08, 0x0F, 0x00], name: '锁定计算机', en: 'Lock computer' },   // Win+L
  { bytes: [0x00, 0x08, 0x15, 0x00], name: '运行命令', en: 'Run' },     // Win+R
  { bytes: [0x00, 0x01, 0x2E, 0x00], name: '放大', en: 'Zoom in' },         // Ctrl+=
  { bytes: [0x00, 0x01, 0x2D, 0x00], name: '缩小', en: 'Zoom out' },         // Ctrl+-
  { bytes: [0x00, 0x08, 0x07, 0x00], name: '显示桌面', en: 'Show desktop' },     // Win+D
  { bytes: [0x00, 0x05, 0x4C, 0x00], name: '任务管理器', en: 'Task Manager' },   // Ctrl+Alt+Delete
  { bytes: [0x00, 0x01, 0x1D, 0x00], name: '撤销', en: 'Undo' },         // Ctrl+Z
  { bytes: [0x00, 0x01, 0x16, 0x00], name: '保存', en: 'Save' },         // Ctrl+S
  { bytes: [0x00, 0x00, 0x00, 0x00], name: '无功能', en: 'No function' },
  { bytes: [0x07, 0x00, 0x00, 0x01], name: '锁 Win 键', en: 'Lock Win key' },
  { bytes: [0x07, 0x00, 0x00, 0x02], name: '锁键盘', en: 'Lock keyboard' },
  { bytes: [0x07, 0x00, 0x00, 0x04], name: '复位键盘', en: 'Reset keyboard' },
];

// ---- 键盘内置功能（类型 0x07，[07 00 00 功能号]）----
// 01/02/04：官方命令表直接给出名称。其余按 KB.ini [FN1] 的出厂位置对照纸质说明书（2026-10-27）：
// Fn+1/2/3 短按切换蓝牙设备、长按 3 秒配对；Fn+` 短按 2.4G 模式、长按 3 秒配对；Fn+B 灯带显示电量；
// Fn+Q/W/E/R 切换 Android/Windows/Mac/iOS 模式。Fn+G 说明书里没有写，sure=false
export const BUILTIN = {
  0x01: { name: '锁 Win 键', en: 'Lock Win key', sure: true },
  0x02: { name: '锁键盘', en: 'Lock keyboard', sure: true },
  0x04: { name: '复位键盘', en: 'Reset keyboard', sure: true },
  0x05: { name: '蓝牙设备 1（长按 3 秒配对）', en: 'Bluetooth device 1 (hold 3 s to pair)', sure: true },
  0x06: { name: '蓝牙设备 2（长按 3 秒配对）', en: 'Bluetooth device 2 (hold 3 s to pair)', sure: true },
  0x07: { name: '蓝牙设备 3（长按 3 秒配对）', en: 'Bluetooth device 3 (hold 3 s to pair)', sure: true },
  0x08: { name: '2.4G 模式（长按 3 秒配对）', en: '2.4G mode (hold 3 s to pair)', sure: true },
  0x0A: { name: 'Fn+G 出厂功能', en: 'Fn+G factory function', sure: false },
  0x0C: { name: '灯带显示电量', en: 'Show battery on light strip', sure: true },
  0x18: { name: '切换到 Windows 模式（Fn+W）', en: 'Windows mode (Fn+W)', sure: true },
  0x19: { name: '切换到 Android 模式（Fn+Q）', en: 'Android mode (Fn+Q)', sure: true },
  0x1A: { name: '切换到 Mac 模式（Fn+E）', en: 'Mac mode (Fn+E)', sure: true },
  0x1B: { name: '切换到 iOS 模式（Fn+R）', en: 'iOS mode (Fn+R)', sure: true },
};

// ---- 灯光控制（类型 0x08，[08 项目 方向 区域]）----
// 项目 0 灯效 / 2 颜色 / 3 亮度 / 4 速度；方向 0 循环、1 加、2 减（实机按 Fn 组合键对比确认）
export const LIGHT = [
  { bytes: [0x08, 0x00, 0x00, 0x00], name: '切换灯效', en: 'Next effect' },
  { bytes: [0x08, 0x02, 0x00, 0x00], name: '切换颜色', en: 'Next color' },
  { bytes: [0x08, 0x03, 0x01, 0x00], name: '亮度 +', en: 'Brightness +' },
  { bytes: [0x08, 0x03, 0x02, 0x00], name: '亮度 -', en: 'Brightness -' },
  { bytes: [0x08, 0x04, 0x01, 0x00], name: '速度 +', en: 'Speed +' },
  { bytes: [0x08, 0x04, 0x02, 0x00], name: '速度 -', en: 'Speed -' },
];
const LIGHT_ITEM = {
  0: { name: '灯效', en: 'effect' }, 2: { name: '颜色', en: 'color' }, 3: { name: '亮度', en: 'brightness' }, 4: { name: '速度', en: 'speed' },
};
// 区域：0 = 键盘背光（上面的表）；1 = 侧灯、2 = 灯带（出厂 FN1 层的位置和说明书“RGB Sidelight / Light Strip Adjustment”一致）
const LIGHT_AREA = { 1: { name: '侧灯', en: 'Side light' }, 2: { name: '灯带', en: 'Light strip' } };

// ---- Fn 键（类型 0x0D，[0D 层-1 00 00]）----
export const FN_KEYS = [
  { bytes: [0x0D, 0x00, 0x00, 0x00], name: 'FN1' },
  { bytes: [0x0D, 0x01, 0x00, 0x00], name: 'FN2' },
];

// ---- 宏（类型 0x03，[03 模式 次数 宏序号]）----
// 模式 1 按次数执行（次数 = b2）、2 循环直到按键松开、4 循环直到任意键按下（这两种次数 = 1）
// 宏序号 = 宏数据区索引表中的位置，从 0 开始（官方 FillMatrix 0x48D3xx：Buffer_ID - 1）
export const MACRO_MODES = {
  1: { name: '执行指定次数', en: 'run N times' }, 2: { name: '循环直到按键松开', en: 'loop until released' },
  4: { name: '循环直到任意键按下', en: 'loop until any key' },
};

// ---- 编码 ----
// action：
//   { kind: 'key', key: HID, key2?: HID, mods?: 位图 }   单键 / 组合键
//   { kind: 'mods', mods: 位图 }                          单独的修饰键（出厂就是这种写法，例如 LShift = 00 02 00 00）
//   { kind: 'media', usage }
//   { kind: 'macro', index, mode?: 1|2|4, count? }
//   { kind: 'raw', bytes }                                 鼠标 / 命令 / 内置 / 灯光 / Fn 等直接用上面表里的 bytes
//   { kind: 'none' }                                        无功能
export function encode(action) {
  switch (action.kind) {
    case 'none': return Uint8Array.of(0, 0, 0, 0);
    case 'mods': return Uint8Array.of(0, byte(action.mods, t('kc.wMods')), 0, 0);
    case 'key': {
      if (!HID_NAMES[action.key]) throw new Error(t('kc.usage', { v: hx(action.key) }));
      if (action.key2 && !HID_NAMES[action.key2]) throw new Error(t('kc.usage', { v: hx(action.key2) }));
      return Uint8Array.of(0, byte(action.mods || 0, t('kc.wMods')), action.key2 || 0, action.key);
    }
    case 'media': {
      const u = action.usage;
      if (!Number.isInteger(u) || u <= 0 || u > 0xFFFF) throw new Error(t('kc.mediaUsage', { v: u }));
      return Uint8Array.of(0x02, 0, u >> 8, u & 0xFF);
    }
    case 'macro': {
      const mode = action.mode ?? 1;
      if (!MACRO_MODES[mode]) throw new Error(t('kc.macroMode', { v: mode }));
      const count = mode === 1 ? (action.count ?? 1) : 1;
      if (!Number.isInteger(count) || count < 1 || count > 255) throw new Error(t('kc.macroCount', { v: count }));
      return Uint8Array.of(0x03, mode, count, byte(action.index, t('kc.wMacro')));
    }
    case 'raw': {
      if (action.bytes?.length !== 4) throw new Error(t('kc.raw4'));
      return Uint8Array.from(action.bytes, v => byte(v, t('kc.wCode')));
    }
    default: throw new Error(t('kc.kind', { v: action.kind }));
  }
}

// ---- 解码（读回的 4 字节 → 显示用）----
// 官方程序不会把矩阵读回界面（CDevG5KB 没有反向转换），这里按编码规则逆推
export function decode(c) {
  const [type, a, b, k] = c;
  const sure = { sure: true };
  if (!type && !a && !b && !k) return { kind: 'none', name: t('kc.none'), ...sure };
  const tableHit = [...COMMANDS, ...MOUSE, ...LIGHT, ...FN_KEYS].find(e => same(e.bytes, c));
  if (type === 0x00) {
    const mods = MODS.filter((_, i) => a & (1 << i));
    const keys = [k, b].filter(Boolean).map(v => HID_NAMES[v] || `0x${hx(v)}`);
    const combo = [...mods, ...keys].join('+');
    if (!b && !k) return { kind: 'mods', mods: a, name: combo, ...sure };
    return { kind: 'key', key: k || b, key2: k ? b : 0, mods: a, name: tableHit ? t('kc.combo', { name: L(tableHit), combo }) : combo, ...sure };
  }
  if (type === 0x01) {
    if (tableHit) return { kind: 'mouse', name: L(tableHit), ...sure };
    if (MOUSE_BUTTONS[a]) return { kind: 'mouse', name: t('kc.mouseN', { btn: L(MOUSE_BUTTONS[a]), n: b, gap: k ? t('kc.gap', { v: k }) : '' }), sure: false };
    return { kind: 'mouse', name: t('kc.mouseRaw', { hex: hexs(c) }), sure: false };
  }
  if (type === 0x02) {
    const usage = (b << 8) | k;
    const m = MEDIA.find(e => e.usage === usage);
    return { kind: 'media', usage, name: m ? L(m) : t('kc.media', { v: hx(usage, 3) }), sure: !!m };
  }
  if (type === 0x03) {
    return { kind: 'macro', index: k, mode: a, count: b,
      name: t('kc.macro', { n: k + 1, mode: MACRO_MODES[a] ? L(MACRO_MODES[a]) : t('kc.mode', { v: a }), times: a === 1 ? ` ×${b}` : '' }), sure: !!MACRO_MODES[a] };
  }
  if (type === 0x07 && !a && !b) {
    const f = BUILTIN[k];
    return { kind: 'builtin', fn: k, name: f ? L(f) : t('kc.builtin', { v: hx(k) }), sure: !!f?.sure };
  }
  if (type === 0x08) {
    if (tableHit) return { kind: 'light', name: L(tableHit), ...sure };
    const item = LIGHT_ITEM[a] ? L(LIGHT_ITEM[a]) : t('kc.lightItem', { v: a });
    const what = b === 0 ? t('kc.cycle', { item }) : b === 1 ? `${item} +` : b === 2 ? `${item} -` : `${item} ?${b}`;
    const area = LIGHT_AREA[k];
    return { kind: 'light', name: area ? t('kc.area', { area: L(area), what }) : t('kc.areaN', { what, k }), sure: !!area && !!LIGHT_ITEM[a] && b <= 2 };
  }
  if (type === 0x0D && !b && !k && a <= 1) return { kind: 'fn', name: FN_KEYS[a].name, ...sure };
  return { kind: 'unknown', name: t('kc.unknown', { hex: hexs(c) }), sure: false };
}

// ---- 矩阵 ----
export function matrixSignatureOk(m) {
  return m.length === MATRIX_SIZE && same(m.subarray(SIG_SLOT * 4, SIG_SLOT * 4 + 4), SIG_BYTES);
}

export const getSlot = (m, slot) => m.subarray(slot * 4, slot * 4 + 4);

// 返回新的一层矩阵，只改 changes 里给出的键：{ 键名: action 或 4 字节 }
export function applyMatrix(base, changes) {
  const m = Uint8Array.from(base);
  for (const [name, v] of Object.entries(changes)) {
    const slot = SLOT[name];
    if (slot === undefined) throw new Error(t('kc.noKey', { v: name }));
    m.set(v instanceof Uint8Array || Array.isArray(v) ? encode({ kind: 'raw', bytes: v }) : encode(v), slot * 4);
  }
  return m;
}

// 返回新的一层矩阵：87 个按键槽位换成 source 的内容，其他槽位（含签名）保持 current 原样（恢复出厂、还原备份、导入配置共用）
export function copyMatrix(current, source) {
  if (source.length !== MATRIX_SIZE) throw new Error(t('kc.mxLen', { want: MATRIX_SIZE, got: source.length }));
  const m = Uint8Array.from(current);
  for (const k of KEYS) m.set(getSlot(source, k.slot), k.slot * 4);
  return m;
}

// 写入前的最后一道检查：长度、签名，以及只改了键盘上存在的键对应的槽位
export function checkMatrixWrite(current, next) {
  if (next.length !== MATRIX_SIZE) throw new Error(t('kc.mxLen', { want: MATRIX_SIZE, got: next.length }));
  if (!matrixSignatureOk(next)) throw new Error(t('kc.mxSig'));
  if (!matrixSignatureOk(current)) throw new Error(t('kc.mxSigDev'));
  const used = new Set(KEYS.map(k => k.slot));
  for (let s = 0; s < MATRIX_LEN; s++) {
    if (!same(getSlot(current, s), getSlot(next, s)) && !used.has(s)) {
      throw new Error(t('kc.slot', { s }));
    }
  }
}

function byte(v, what) {
  if (!Number.isInteger(v) || v < 0 || v > 0xFF) throw new Error(t('kc.byte', { what, v }));
  return v;
}
const same = (x, y) => x.length === y.length && Array.prototype.every.call(x, (v, i) => v === y[i]);
const hx = (v, w = 2) => v.toString(16).toUpperCase().padStart(w, '0');
const hexs = c => Array.from(c, v => hx(v)).join(' ');
