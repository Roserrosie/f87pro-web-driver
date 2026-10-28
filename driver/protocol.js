// AULA F87 PRO 有线协议（来自 OemDrv.exe 逆向 + 实机验证，见 docs/PROTOCOL.md）
// 只实现有线通道：UsagePage 0xFF00 / Usage 0x01，Feature Report 0x06。

export const WIRED_FILTER = { vendorId: 0x258A, productId: 0x010C, usagePage: 0xFF00, usage: 0x01 };
export const DONGLE_FILTER = { vendorId: 0x3554, productId: 0xFA09, usagePage: 0xFF02, usage: 0x02 };
export const REPORT_ID = 0x06;

import { MATRIX_SIZE, matrixSignatureOk, checkMatrixWrite } from './keycodes.js';
import { t } from './i18n.js';

export const CMD = {
  GET_PSD: 0x82,
  GET_LED: 0x84,
  SET_LED: 0x04,
  GET_MATRIX: 0x83,
  SET_MATRIX: 0x03,
  GET_RGB: 0x8A,
  SET_RGB: 0x0A,
};
// 允许发送的命令。写命令只有 SET_LED、SET_MATRIX、SET_RGB
const ALLOWED = new Set(Object.values(CMD));

export const PSD_F87PRO = [0x03, 0x00, 0x00, 0x00, 0x01, 0x0B];

// UI 序号 = 灯效块 0x0A 的值；参数槽 = ui - 1。名称来自官方 Text/sc/text.xml，英文名参照 Text/en/text.xml 整理，
// 能力来自 KB.ini LedOptN（speed / random(多彩) / color(单色)）
export const EFFECTS = [
  { ui: 1,  name: '常亮模式', en: 'Always On', speed: false, colorful: true,  color: true },
  { ui: 2,  name: '呼吸模式', en: 'Breathing', speed: true,  colorful: true,  color: true },
  { ui: 3,  name: '梦幻彩虹', en: 'Rainbow', speed: true,  colorful: false, color: false },
  { ui: 4,  name: '一触即发', en: 'Flash Away', speed: true,  colorful: true,  color: true },
  { ui: 5,  name: '雨中漫步', en: 'Raindrops', speed: true,  colorful: true,  color: true },
  { ui: 6,  name: '彩虹轮盘', en: 'Rainbow Wheel', speed: true,  colorful: true,  color: true },
  { ui: 7,  name: '涟漪扩散', en: 'Ripples', speed: true,  colorful: true,  color: true },
  { ui: 8,  name: '繁星点点', en: 'Twinkling Stars', speed: true,  colorful: true,  color: true },
  { ui: 9,  name: '踏雪无痕', en: 'Vanishing Trail', speed: true,  colorful: true,  color: true },
  { ui: 10, name: '川流不息', en: 'Retro Snake', speed: true,  colorful: true,  color: true },
  { ui: 11, name: '随波逐流', en: 'Neon Stream', speed: true,  colorful: true,  color: true },
  { ui: 12, name: '如影随形', en: 'Reactive', speed: true,  colorful: true,  color: true },
  { ui: 13, name: '正弦光波', en: 'Sine Wave', speed: true,  colorful: true,  color: true },
  { ui: 14, name: '左右扫描', en: 'Side Scan', speed: true,  colorful: true,  color: true },
  { ui: 15, name: '旋转风车', en: 'Windmill', speed: true,  colorful: false, color: false },
  { ui: 16, name: '七彩瀑布', en: 'Color Waterfall', speed: true,  colorful: false, color: false },
  { ui: 17, name: '花开富贵', en: 'Blossoming', speed: true,  colorful: false, color: false },
  { ui: 18, name: '旋转风暴', en: 'Rotating Storm', speed: true,  colorful: true,  color: true },
];

// KB.ini [OPT] LedMask：第 (ui-1) 位为 1 的灯效被官方驱动隐藏，固件不支持（实测会灭灯）
export const LED_MASK = 0x22120; // → 6 彩虹轮盘、9 踏雪无痕、14 左右扫描、18 旋转风暴
export const isSupported = ui => EFFECTS.some(e => e.ui === ui) && !((LED_MASK >> (ui - 1)) & 1);
export const SUPPORTED_EFFECTS = EFFECTS.filter(e => isSupported(e.ui));

// 颜色编号 0–6 来自逆向推测（侧灯映射），7 = 多彩已实测
export const COLORS = [
  { v: 0, name: '红', en: 'Red', css: '#ff3b3b' },
  { v: 1, name: '绿', en: 'Green', css: '#2fd16b' },
  { v: 2, name: '蓝', en: 'Blue', css: '#3d7bff' },
  { v: 3, name: '黄', en: 'Yellow', css: '#ffd23d' },
  { v: 4, name: '紫', en: 'Purple', css: '#d24dff' },
  { v: 5, name: '青', en: 'Cyan', css: '#2fe0e6' },
  { v: 6, name: '白', en: 'White', css: '#f2f4f8' },
  { v: 7, name: '多彩', en: 'Multicolor', css: 'conic-gradient(#ff3b3b,#ffd23d,#2fd16b,#2fe0e6,#3d7bff,#d24dff,#ff3b3b)' },
];

export const LED = {
  SIZE: 128,
  DEBOUNCE: 0x03,
  EFFECT: 0x0A,
  SLEEP: 0x18,
  SLOT_BASE: 0x3A,
  SIG: 0x7E,
};
export const MAX_LEVEL = 4;

// 防抖：KB.ini ShowDebounce=0x04000101 → 最大 4、最小 0、默认 1。官方界面显示“硬件值+1 档”，没有毫秒换算
export const DEBOUNCE = { MIN: 0, MAX: 4, DEFAULT: 1 };
// 休眠：KB.ini SleepUI / SleepHW（硬件单位 30 秒）
export const SLEEP_OPTIONS = [
  { sec: 60, hw: 2 }, { sec: 90, hw: 3 }, { sec: 120, hw: 4 }, { sec: 180, hw: 6 }, { sec: 240, hw: 8 },
  { sec: 300, hw: 10 }, { sec: 600, hw: 20 }, { sec: 900, hw: 30 }, { sec: 1200, hw: 40 },
];

const slotOffset = ui => LED.SLOT_BASE + 2 * (ui - 1);

// 网页版允许修改的灯效块字节：当前灯效、防抖、休眠、18 个灯效的参数槽
export const LED_WRITABLE = new Set([LED.EFFECT, LED.DEBOUNCE, LED.SLEEP,
  ...EFFECTS.flatMap(e => [slotOffset(e.ui), slotOffset(e.ui) + 1])]);

export function ledSignatureOk(b) {
  return b.length === LED.SIZE && b[LED.SIG] === 0x5A && b[LED.SIG + 1] === 0xA5;
}

export function parseLed(b) {
  const effects = EFFECTS.map(e => {
    const o = slotOffset(e.ui);
    return { ui: e.ui, brightness: b[o], speed: b[o + 1] >> 4, color: b[o + 1] & 0x0F };
  });
  return { effect: b[LED.EFFECT], effects, sleep: b[LED.SLEEP], debounce: b[LED.DEBOUNCE], sigOk: ledSignatureOk(b) };
}

// 返回一份新的灯效块，只改 changes 里给出的字段，其余字节原样保留。
// changes: { effect?: ui, params?: { [ui]: { brightness?, speed?, color? } }, debounce?: 0–4, sleep?: SleepHW 值 }
export function applyLed(base, changes) {
  const b = Uint8Array.from(base);
  if (changes.debounce !== undefined) b[LED.DEBOUNCE] = assertDebounce(changes.debounce);
  if (changes.sleep !== undefined) b[LED.SLEEP] = assertSleep(changes.sleep);
  if (changes.effect !== undefined) {
    assertEffect(changes.effect);
    if (!isSupported(changes.effect)) throw new Error(t('pe.unsupported', { ui: changes.effect }));
    b[LED.EFFECT] = changes.effect;
  }
  for (const [uiKey, p] of Object.entries(changes.params || {})) {
    const ui = Number(uiKey);
    assertEffect(ui);
    const o = slotOffset(ui);
    let br = b[o], sp = b[o + 1] >> 4, co = b[o + 1] & 0x0F;
    if (p.brightness !== undefined) br = assertLevel(p.brightness, t('w.brightness'));
    if (p.speed !== undefined) sp = assertLevel(p.speed, t('w.speed'));
    if (p.color !== undefined) co = assertColor(p.color);
    b[o] = br;
    b[o + 1] = (sp << 4) | co;
  }
  return b;
}

// 返回新的灯效块：允许修改的字节换成 source 里的值，其他字节保持 current 原样（恢复出厂、导入配置共用）
export function copyLed(current, source) {
  if (source.length !== LED.SIZE) throw new Error(t('pe.ledLen', { want: LED.SIZE, got: source.length }));
  const b = Uint8Array.from(current);
  for (const i of LED_WRITABLE) b[i] = source[i];
  return b;
}

// 写入前的最后一道检查：长度、签名，以及与设备当前内容相比只改了允许的字节（灯效、防抖、休眠）
export function checkLedWrite(current, next) {
  if (next.length !== LED.SIZE) throw new Error(t('pe.ledLen', { want: LED.SIZE, got: next.length }));
  if (!ledSignatureOk(next)) throw new Error(t('pe.ledSig'));
  if (!ledSignatureOk(current)) throw new Error(t('pe.ledSigDev'));
  for (let i = 0; i < LED.SIZE; i++) {
    if (current[i] !== next[i] && !LED_WRITABLE.has(i)) {
      throw new Error(t('pe.ledByte', { off: i.toString(16).toUpperCase() }));
    }
  }
  // 这两个字节如果要改，新值必须在官方允许的范围内
  const range = (off, ok, what) => {
    if (current[off] !== next[off] && !ok(next[off])) {
      throw new Error(t('pe.ledRange', { off: off.toString(16).toUpperCase(), what, v: next[off] }));
    }
  };
  range(LED.DEBOUNCE, v => v >= DEBOUNCE.MIN && v <= DEBOUNCE.MAX, t('w.debounce'));
  range(LED.SLEEP, v => SLEEP_OPTIONS.some(o => o.hw === v), t('w.sleep'));
}

// ---- 颜色表（cmd 0x0A / 0x8A），布局来自官方写入代码 0x48E0DA，见主报告 3.5 ----
// 每段 21 字节 = 7 种颜色 × [R, G, B]（RGBIndex=0,1,2）。第 0 段官方留空，第 n 段 = LedOpt 第 n 项 = UI 序号 n。
// CRC=1 时补到 512 字节，0x1FA/0x1FB 写 5A A5。2026-10-27 实机读 0x8A：格式和写入完全一致，第 1–13 段是出厂调色板
export const RGB = { SIZE: 0x200, SEG: 0x15, SIG: 0x1FA, COLORS: 7 };
// 只写“支持的、能选颜色的灯效”用到的段：1 到其中最大的 UI 序号（= 13，正好是实机里有颜色数据的 1–13 段）
export const RGB_SEGMENTS = Array.from(
  { length: Math.max(...SUPPORTED_EFFECTS.filter(e => e.color).map(e => e.ui)) }, (_, i) => i + 1);
// 官方默认调色板（0x411D34），也就是颜色编号 0–6
export const DEFAULT_PALETTE = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255]];
const rgbSeg = n => n * RGB.SEG;

export function rgbSignatureOk(b) {
  return b.length === RGB.SIZE && b[RGB.SIG] === 0x5A && b[RGB.SIG + 1] === 0xA5;
}

// 返回第 n 段的 7 种颜色 [[r,g,b] × 7]
export function rgbSegment(b, n) {
  return Array.from({ length: RGB.COLORS }, (_, c) => Array.from(b.subarray(rgbSeg(n) + c * 3, rgbSeg(n) + c * 3 + 3)));
}

// 所有灯效共用一套颜色：把 palette 写进 RGB_SEGMENTS 的每一段，其余字节原样保留
export function applyPalette(base, palette) {
  if (!Array.isArray(palette) || palette.length !== RGB.COLORS) throw new Error(t('pe.palette', { n: RGB.COLORS }));
  for (const c of palette) {
    if (!Array.isArray(c) || c.length !== 3 || c.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error(t('pe.color', { v: JSON.stringify(c) }));
  }
  const b = Uint8Array.from(base);
  for (const n of RGB_SEGMENTS) palette.forEach((c, i) => b.set(c, rgbSeg(n) + i * 3));
  return b;
}

// 返回新的颜色表：RGB_SEGMENTS 里的段换成 source 的内容，其他字节保持 current 原样（还原备份、导入配置共用）
export function copyRgb(current, source) {
  if (source.length !== RGB.SIZE) throw new Error(t('pe.rgbLen', { want: RGB.SIZE, got: source.length }));
  const b = Uint8Array.from(current);
  for (const n of RGB_SEGMENTS) b.set(source.subarray(rgbSeg(n), rgbSeg(n + 1)), rgbSeg(n));
  return b;
}

// 写入前检查：长度、签名，只改了 RGB_SEGMENTS 里的段
export function checkRgbWrite(current, next) {
  if (next.length !== RGB.SIZE) throw new Error(t('pe.rgbLen', { want: RGB.SIZE, got: next.length }));
  if (!rgbSignatureOk(next)) throw new Error(t('pe.rgbSig'));
  if (!rgbSignatureOk(current)) throw new Error(t('pe.rgbSigDev'));
  const lo = rgbSeg(RGB_SEGMENTS[0]), hi = rgbSeg(RGB_SEGMENTS.at(-1) + 1);
  for (let i = 0; i < RGB.SIZE; i++) {
    if (current[i] !== next[i] && (i < lo || i >= hi)) {
      throw new Error(t('pe.rgbByte', { off: i.toString(16).toUpperCase(), a: RGB_SEGMENTS[0], b: RGB_SEGMENTS.at(-1) }));
    }
  }
}

function assertEffect(ui) {
  if (!EFFECTS.some(e => e.ui === ui)) throw new Error(t('pe.effectNo', { ui }));
}
function assertLevel(v, what) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_LEVEL) throw new Error(t('pe.level', { what, max: MAX_LEVEL, v }));
  return v;
}
function assertColor(v) {
  if (!Number.isInteger(v) || v < 0 || v > 7) throw new Error(t('pe.colorNo', { v }));
  return v;
}
function assertDebounce(v) {
  if (!Number.isInteger(v) || v < DEBOUNCE.MIN || v > DEBOUNCE.MAX) throw new Error(t('pe.debounce', { min: DEBOUNCE.MIN, max: DEBOUNCE.MAX, v }));
  return v;
}
function assertSleep(v) {
  if (!SLEEP_OPTIONS.some(o => o.hw === v)) throw new Error(t('pe.sleep', { list: SLEEP_OPTIONS.map(o => o.hw).join('/'), v }));
  return v;
}

// 帧（不含报告 ID）：cmd sub 00 总包数 包序号 长度低 长度高 数据[512]
export function buildFrame(cmd, sub, packets, index, length, data) {
  const f = new Uint8Array(519);
  f[0] = cmd; f[1] = sub; f[2] = 0; f[3] = packets; f[4] = index;
  f[5] = length & 0xFF; f[6] = length >> 8;
  if (data) f.set(data, 7);
  return f;
}

// 回复长度不固定（灯效块 136 字节、矩阵 520 字节），但回复头会回显命令号
export function stripReply(bytes, cmd) {
  if (bytes[0] === REPORT_ID && bytes[1] === cmd) return bytes.subarray(1);
  if (bytes[0] === cmd) return bytes;
  throw new Error(t('pe.reply', { cmd: cmd.toString(16), head: hex(bytes.subarray(0, 8)) }));
}

export const hex = b => Array.from(b, v => v.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Keyboard {
  constructor(device, { log = () => {}, delay = sleep } = {}) {
    this.dev = device;
    this.log = log;
    this.delay = delay;
  }

  static isWired(device) {
    return device.collections.some(c => c.usagePage === 0xFF00 && c.usage === 0x01
      && c.featureReports.some(r => r.reportId === REPORT_ID));
  }

  async #send(frame) {
    if (!ALLOWED.has(frame[0])) throw new Error(t('pe.cmd', { cmd: frame[0].toString(16) }));
    for (let attempt = 1; ; attempt++) {
      try {
        await this.dev.sendFeatureReport(REPORT_ID, frame);
        return;
      } catch (e) {
        if (attempt >= 3) throw e;
        this.log('err', t('pl.retry', { msg: e.message }));
        await this.delay(70);
      }
    }
  }

  async read(cmd, sub, length) {
    const out = new Uint8Array(length);
    const packets = Math.ceil(length / 512);
    for (let i = 0; i < packets; i++) {
      const chunk = Math.min(512, length - i * 512);
      await this.delay(20);
      this.log('tx', t('pl.read', { cmd: cmd.toString(16), sub, i: i + 1, n: packets }));
      await this.#send(buildFrame(cmd, sub, packets, i, chunk));
      await this.delay(20);
      const dv = await this.dev.receiveFeatureReport(REPORT_ID);
      const r = stripReply(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), cmd);
      if (r.length < 7 + chunk) throw new Error(t('pe.short', { want: chunk, got: r.length - 7 }));
      out.set(r.subarray(7, 7 + chunk), i * 512);
    }
    this.log('rx', t('pl.got', { cmd: cmd.toString(16), n: length }));
    return out;
  }

  async write(cmd, sub, data) {
    const packets = Math.ceil(data.length / 512);
    for (let i = 0; i < packets; i++) {
      const chunk = data.subarray(i * 512, i * 512 + 512);
      await this.delay(20);
      this.log('tx', t('pl.write', { cmd: cmd.toString(16), sub, i: i + 1, n: packets, head: hex(chunk.subarray(0, 16)) }));
      await this.#send(buildFrame(cmd, sub, packets, i, chunk.length, chunk));
    }
  }

  readPsd() { return this.read(CMD.GET_PSD, 1, 6); }

  // 官方驱动也会在签名不对时重读，最多 5 次
  async readLed() {
    for (let attempt = 1; ; attempt++) {
      const b = await this.read(CMD.GET_LED, 0, LED.SIZE);
      if (ledSignatureOk(b)) return b;
      if (attempt >= 5) throw new Error(t('pe.ledGiveUp'));
      this.log('err', t('pl.ledRetry'));
      await this.delay(100);
    }
  }

  // 先读后写：读取设备当前内容 → 检查 → 写入 → 读回校验。返回写入前的内容（用于备份）
  async writeLed(makeNext, { onBackup } = {}) {
    const current = await this.readLed();
    const next = makeNext(current);
    checkLedWrite(current, next);
    if (onBackup) await onBackup(current);
    const changed = [];
    for (let i = 0; i < LED.SIZE; i++) if (current[i] !== next[i]) changed.push(i);
    if (!changed.length) { this.log('info', t('pl.noChange')); return { current, written: false }; }
    this.log('info', t('pl.ledWrite', { n: changed.length, list: changed.map(i => '0x' + i.toString(16).toUpperCase()).join(' ') }));
    await this.delay(60);
    await this.write(CMD.SET_LED, 0, next);
    await this.delay(60);
    const after = await this.readLed();
    const bad = [];
    for (let i = 0; i < LED.SIZE; i++) if (after[i] !== next[i]) bad.push(i);
    if (bad.length) throw new Error(t('pe.readback', { list: bad.map(i => '0x' + i.toString(16).toUpperCase()).join(' ') }));
    this.log('ok', t('pl.ok'));
    return { current, after, written: true };
  }

  // 官方程序从不读颜色表，但实机确认固件支持 0x8A，回复 512 字节，签名在 0x1FA
  async readRgb() {
    for (let attempt = 1; ; attempt++) {
      const b = await this.read(CMD.GET_RGB, 0, RGB.SIZE);
      if (rgbSignatureOk(b)) return b;
      if (attempt >= 5) throw new Error(t('pe.rgbGiveUp'));
      this.log('err', t('pl.rgbRetry'));
      await this.delay(100);
    }
  }

  // 和 writeLed 相同的流程。官方写颜色表前会等 130ms，整块 512 字节一包（cmd 0x0A，sub 0）
  async writeRgb(makeNext, { onBackup } = {}) {
    const current = await this.readRgb();
    const next = makeNext(current);
    checkRgbWrite(current, next);
    if (onBackup) await onBackup(current);
    const changed = [];
    for (let i = 0; i < RGB.SIZE; i++) if (current[i] !== next[i]) changed.push(i);
    if (!changed.length) { this.log('info', t('pl.noChange')); return { current, written: false }; }
    this.log('info', t('pl.rgbWrite', { n: changed.length }));
    await this.delay(130);
    await this.write(CMD.SET_RGB, 0, next);
    await this.delay(60);
    const after = await this.readRgb();
    const bad = [];
    for (let i = 0; i < RGB.SIZE; i++) if (after[i] !== next[i]) bad.push(i);
    if (bad.length) throw new Error(t('pe.readback', { list: bad.map(i => '0x' + i.toString(16).toUpperCase()).join(' ') }));
    this.log('ok', t('pl.ok'));
    return { current, after, written: true };
  }

  async readMatrix(layer) {
    assertLayer(layer);
    for (let attempt = 1; ; attempt++) {
      const m = await this.read(CMD.GET_MATRIX, layer, MATRIX_SIZE);
      if (matrixSignatureOk(m)) return m;
      if (attempt >= 5) throw new Error(t('pe.mxGiveUp', { l: layer }));
      this.log('err', t('pl.mxRetry', { l: layer }));
      await this.delay(100);
    }
  }

  // 和 writeLed 相同的流程。官方程序每层整包写 512 字节（cmd 0x03，sub = 层号），写完间隔 50ms，没有额外的提交命令
  async writeMatrix(layer, makeNext, { onBackup } = {}) {
    const current = await this.readMatrix(layer);
    const next = makeNext(current);
    checkMatrixWrite(current, next);
    if (onBackup) await onBackup(current);
    const changed = [];
    for (let s = 0; s < MATRIX_SIZE / 4; s++) {
      if (next.subarray(s * 4, s * 4 + 4).some((v, i) => v !== current[s * 4 + i])) changed.push(s);
    }
    if (!changed.length) { this.log('info', t('pl.noChange')); return { current, written: false }; }
    this.log('info', t('pl.mxWrite', { l: layer, n: changed.length, list: changed.join(' ') }));
    await this.delay(60);
    await this.write(CMD.SET_MATRIX, layer, next);
    await this.delay(60);
    const after = await this.readMatrix(layer);
    const bad = [];
    for (let i = 0; i < MATRIX_SIZE; i++) if (after[i] !== next[i]) bad.push(i >> 2);
    if (bad.length) throw new Error(t('pe.mxReadback', { list: [...new Set(bad)].join(' ') }));
    this.log('ok', t('pl.ok'));
    return { current, after, written: true };
  }
}

function assertLayer(layer) {
  if (![0, 1, 2, 3].includes(layer)) throw new Error(t('pe.layer', { v: layer }));
}
