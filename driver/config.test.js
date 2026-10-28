import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildConfig, parseConfig, diffConfig, IMPORT_COPY, sleepLabel, debounceLabel } from './config.js';
import { FACTORY_LED, FACTORY_LAYERS } from './factory.js';
import {
  PSD_F87PRO, LED, applyLed, applyPalette, copyLed, copyRgb, checkLedWrite, checkRgbWrite, hex, DEFAULT_PALETTE,
} from './protocol.js';
import {
  KEYS, SLOT, getSlot, applyMatrix, copyMatrix, checkMatrixWrite, encode, decode,
  CODE_TO_HID, HID_NAMES, modBit, recordedAction, keyAction,
} from './keycodes.js';

const load = f => JSON.parse(readFileSync(new URL(`../tools/${f}`, import.meta.url), 'utf8'));
const bytes = s => Uint8Array.from(s.trim().split(/\s+/), h => parseInt(h, 16));
const LAYER = load('dump-2026-10-25-wired.json').layers.map(bytes);
const REAL_RGB = bytes(load('dump-2026-10-27-wired-rgb.json').rgb);
const CURRENT = { led: FACTORY_LED, rgb: REAL_RGB, layers: { 0: LAYER[0], 1: LAYER[1] } };
const exported = (over = {}) => JSON.parse(JSON.stringify(buildConfig({ psd: PSD_F87PRO, ...CURRENT, time: new Date(0), ...over })));

// ---- 拷贝函数 ----

test('copyLed 只拷允许修改的字节', () => {
  const src = applyLed(FACTORY_LED, { effect: 2, debounce: 3, sleep: 40, params: { 2: { brightness: 1 } } });
  src[0x17] = 0x55; // 不归网页版管
  const next = copyLed(FACTORY_LED, src);
  assert.deepEqual(next, applyLed(FACTORY_LED, { effect: 2, debounce: 3, sleep: 40, params: { 2: { brightness: 1 } } }));
  checkLedWrite(FACTORY_LED, next);
  assert.throws(() => copyLed(FACTORY_LED, new Uint8Array(5)), /长度/);
});

test('copyRgb 只拷第 1–13 段', () => {
  const src = applyPalette(REAL_RGB, DEFAULT_PALETTE.map(() => [7, 8, 9]));
  src[0] = 0x33; src[0x1F0] = 0x44; // 段外
  const next = copyRgb(REAL_RGB, src);
  assert.deepEqual(next, applyPalette(REAL_RGB, DEFAULT_PALETTE.map(() => [7, 8, 9])));
  checkRgbWrite(REAL_RGB, next);
});

test('copyMatrix 只拷 87 个按键槽位', () => {
  const src = applyMatrix(LAYER[0], { CapsLock: { kind: 'key', key: 0xE0 } });
  src[6 * 4] = 0x77; // 槽位 6 不对应按键
  const next = copyMatrix(LAYER[0], src);
  assert.deepEqual(next, applyMatrix(LAYER[0], { CapsLock: { kind: 'key', key: 0xE0 } }));
  checkMatrixWrite(LAYER[0], next);
});

// ---- 键码对照表 ----

test('CODE_TO_HID：每个值都是已知的 HID 键，除了 #(ISO) 每个 HID 键都能录入', () => {
  for (const [code, u] of Object.entries(CODE_TO_HID)) assert.ok(HID_NAMES[u], code);
  const reachable = new Set(Object.values(CODE_TO_HID));
  const missing = Object.keys(HID_NAMES).map(Number).filter(u => !reachable.has(u));
  assert.deepEqual(missing, [0x32]);
  // 键盘上 87 个键（除了 Fn）都能通过 code 录入
  assert.equal(CODE_TO_HID.KeyA, 0x04);
  assert.equal(CODE_TO_HID.Digit0, 0x27);
  assert.equal(CODE_TO_HID.F12, 0x45);
  assert.equal(CODE_TO_HID.ContextMenu, 0x65);
  assert.equal(HID_NAMES[CODE_TO_HID.Backquote], '`');
});

test('录入：修饰键位图和组合键', () => {
  assert.equal(modBit('ControlLeft'), 1);
  assert.equal(modBit('ShiftRight'), 0x20);
  assert.equal(modBit('MetaLeft'), 8);
  assert.equal(modBit('KeyA'), 0);
  assert.deepEqual(recordedAction(1, 'KeyC'), { kind: 'key', key: 0x06, mods: 1 });
  assert.equal(decode(encode(recordedAction(1 | 2, 'KeyS'))).name, 'LCtrl+LShift+S');
  assert.deepEqual(recordedAction(2, null), { kind: 'mods', mods: 2 });
  assert.equal(decode(encode(recordedAction(2, null))).name, 'LShift');
  assert.equal(recordedAction(0, null), null);
  assert.equal(recordedAction(0, 'BrowserBack'), null, '不认识的键');
  // 手动选修饰键：存成出厂那种位图写法
  assert.deepEqual(keyAction(0xE3, 1), { kind: 'mods', mods: 9 });
  assert.deepEqual(encode(keyAction(0xE1)), getSlot(LAYER[0], SLOT.LShift));
  assert.deepEqual(keyAction(0x04, 0), { kind: 'key', key: 0x04, mods: 0 });
  assert.equal(keyAction(0, 0), null);
  // 实机默认层里普通键都是 00 00 00 用法码：录入同一个键得到相同的 4 字节
  assert.deepEqual(encode(recordedAction(0, 'KeyA')), getSlot(LAYER[0], SLOT.A));
});

// ---- 导出 / 导入 ----

test('导出再导入：内容不变，和键盘相同时没有要改的', () => {
  const obj = exported();
  assert.equal(obj.psd, hex(PSD_F87PRO));
  assert.deepEqual(Object.keys(obj.layers), ['0', '1']);
  const cfg = parseConfig(obj);
  assert.deepEqual(cfg.led, FACTORY_LED);
  assert.deepEqual(cfg.rgb, REAL_RGB);
  assert.deepEqual(cfg.layers[1], LAYER[1]);
  assert.deepEqual(diffConfig(CURRENT, cfg), { parts: [], locked: [] });
});

test('导入预览：列出灯效、防抖、休眠、颜色和按键的变化', () => {
  const led = applyLed(FACTORY_LED, { effect: 2, debounce: 3, sleep: 40, params: { 2: { color: 1 }, 3: { speed: 1 } } });
  const rgb = applyPalette(REAL_RGB, [[1, 1, 1], ...DEFAULT_PALETTE.slice(1)]);
  const l1 = applyMatrix(LAYER[1], { A: { kind: 'media', usage: 0xE9 }, S: { kind: 'none' } });
  const cfg = parseConfig(exported({ led, rgb, layers: { 0: LAYER[0], 1: l1 } }));
  const d = diffConfig(CURRENT, cfg);
  assert.deepEqual(d.locked, []);
  assert.deepEqual(d.parts.map(p => p.part), ['led', 'rgb', 'layer1']);
  assert.deepEqual(d.parts[0].lines, [
    '当前灯效：随波逐流 → 呼吸模式', '2 个灯效的亮度 / 速度 / 颜色不同', '防抖：2 档 → 4 档', '休眠：5 分钟 → 20 分钟',
  ]);
  assert.deepEqual(d.parts[1].lines, ['1 种颜色不同']);
  assert.match(d.parts[2].lines[0], /^1 个键不同：A$/, 'S 在出厂 FN1 层本来就是空的');
  // 拷贝后写入能通过安全检查，结果就是文件里的内容
  const nextLed = IMPORT_COPY.led(CURRENT.led, cfg);
  checkLedWrite(CURRENT.led, nextLed);
  assert.deepEqual(nextLed, led);
  const nextL1 = IMPORT_COPY.layer1(CURRENT.layers[1], cfg);
  checkMatrixWrite(CURRENT.layers[1], nextL1);
  assert.deepEqual(nextL1, l1);
});

test('导入预览：F1–F12 和 Fn 不同要报出来', () => {
  const l0 = applyMatrix(LAYER[0], { F5: { kind: 'key', key: 0x04 } });
  const d = diffConfig(CURRENT, parseConfig(exported({ layers: { 0: l0, 1: LAYER[1] } })));
  assert.deepEqual(d.locked, ['默认层 F5']);
});

test('导入拒绝：别的工具、别的键盘、坏签名、不支持的灯效、宏、FN2、Fn 键被改', () => {
  assert.throws(() => parseConfig(null), /JSON/);
  assert.throws(() => parseConfig({ ...exported(), tool: 'x' }), /不是本网页驱动/);
  assert.throws(() => parseConfig({ ...exported(), version: 2 }), /版本/);
  assert.throws(() => parseConfig({ ...exported(), psd: '03 00 00 00 01 0C' }), /另一种键盘/);
  assert.throws(() => parseConfig({ tool: 'F87 PRO 网页驱动', version: 1 }), /没有任何配置/);
  const badLed = Uint8Array.from(FACTORY_LED); badLed[LED.SIG] = 0;
  assert.throws(() => parseConfig(exported({ led: badLed })), /签名/);
  const fx6 = Uint8Array.from(FACTORY_LED); fx6[LED.EFFECT] = 6;
  assert.throws(() => parseConfig(exported({ led: fx6 })), /不支持/);
  const short = exported(); short.rgb = short.rgb.slice(0, 30);
  assert.throws(() => parseConfig(short), /长度/);
  const junk = exported(); junk.layers[0] = 'zz';
  assert.throws(() => parseConfig(junk), /十六进制/);
  const macro = applyMatrix(LAYER[1], { A: { kind: 'macro', index: 0 } });
  assert.throws(() => parseConfig(exported({ layers: { 0: LAYER[0], 1: macro } })), /A 键是宏/);
  const fn2 = applyMatrix(LAYER[1], { A: [0x0D, 0x01, 0, 0] });
  assert.throws(() => parseConfig(exported({ layers: { 0: LAYER[0], 1: fn2 } })), /FN2/);
  const noFn = applyMatrix(LAYER[0], { FN: { kind: 'none' } });
  assert.throws(() => parseConfig(exported({ layers: { 0: noFn, 1: LAYER[1] } })), /Fn 键/);
  // 只有部分数据也可以导入
  const partial = exported(); delete partial.layers; delete partial.rgb;
  assert.deepEqual(Object.keys(parseConfig(partial).layers), []);
});

test('显示文字：休眠和防抖', () => {
  assert.equal(sleepLabel(2), '60 秒');
  assert.equal(sleepLabel(3), '90 秒');
  assert.equal(sleepLabel(10), '5 分钟');
  assert.equal(sleepLabel(40), '20 分钟');
  assert.equal(debounceLabel(0), '1 档');
  assert.equal(debounceLabel(4), '5 档');
  assert.equal(KEYS.length, 87);
  assert.ok(FACTORY_LAYERS[0]);
});
