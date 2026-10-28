// 配置文件导出 / 导入（格式是网页版自定的，不需要逆向）。纯逻辑，可在 Node 里测试。
// 导入时只拷贝允许改的部分：灯效块的 LED_WRITABLE 字节、颜色表的 RGB_SEGMENTS 段、矩阵的 87 个按键槽位。

import {
  PSD_F87PRO, EFFECTS, isSupported, MAX_LEVEL, DEBOUNCE, SLEEP_OPTIONS, RGB_SEGMENTS,
  parseLed, ledSignatureOk, rgbSignatureOk, rgbSegment, copyLed, copyRgb, hex,
} from './protocol.js';
import { KEYS, SLOT, FN_KEYS, OFFICIAL_LOCKED, getSlot, decode, matrixSignatureOk, copyMatrix, MATRIX_SIZE } from './keycodes.js';
import { t, L } from './i18n.js';

// 文件格式的标识，导入时靠它识别，不随界面语言变
export const CONFIG_TOOL = 'F87 PRO 网页驱动';
export const CONFIG_VERSION = 1;
export const CONFIG_LAYERS = [0, 1];

// 显示用的文字（设置页和导入预览共用）
export const sleepLabel = hw => {
  const o = SLEEP_OPTIONS.find(x => x.hw === hw);
  if (!o) return t('sl.unknown', { v: hw });
  return o.sec < 120 ? t('sl.sec', { n: o.sec }) : t('sl.min', { n: o.sec / 60 });
};
export const debounceLabel = hw => t('db.level', { n: hw + 1 });
const effectLabel = ui => { const e = EFFECTS.find(x => x.ui === ui); return e ? L(e) : t('fx.unknown', { ui }); };

export function buildConfig({ psd, led, rgb, layers, time = new Date() }) {
  return {
    tool: CONFIG_TOOL, version: CONFIG_VERSION, time: time.toISOString(),
    psd: hex(psd), led: hex(led), rgb: hex(rgb),
    layers: Object.fromEntries(CONFIG_LAYERS.map(l => [l, hex(layers[l])])),
  };
}

const fromHex = (s, len, what) => {
  if (typeof s !== 'string' || !/^\s*([0-9a-fA-F]{2}\s+)*[0-9a-fA-F]{2}\s*$/.test(s)) throw new Error(t('ce.hex', { what }));
  const b = Uint8Array.from(s.trim().split(/\s+/), h => parseInt(h, 16));
  if (b.length !== len) throw new Error(t('ce.len', { what, len, got: b.length }));
  return b;
};

// 校验文件内容，返回 { time, led?, rgb?, layers: { 0?, 1? } }。有问题直接抛出能给用户看的错误
export function parseConfig(obj) {
  if (!obj || typeof obj !== 'object') throw new Error(t('ce.notObj'));
  if (obj.tool !== CONFIG_TOOL) throw new Error(t('ce.tool'));
  if (obj.version !== CONFIG_VERSION) throw new Error(t('ce.version', { v: obj.version }));
  if (obj.psd !== undefined && hex(fromHex(obj.psd, 6, t('cw.psd'))) !== hex(PSD_F87PRO)) {
    throw new Error(t('ce.psd', { psd: obj.psd }));
  }
  const cfg = { time: obj.time, layers: {} };

  if (obj.led !== undefined) {
    const b = fromHex(obj.led, 128, t('cw.led'));
    if (!ledSignatureOk(b)) throw new Error(t('ce.sig', { what: t('cw.led') }));
    const p = parseLed(b);
    if (!isSupported(p.effect)) throw new Error(t('ce.effect', { name: effectLabel(p.effect) }));
    if (p.debounce < DEBOUNCE.MIN || p.debounce > DEBOUNCE.MAX) throw new Error(t('ce.debounce', { v: p.debounce }));
    if (!SLEEP_OPTIONS.some(o => o.hw === p.sleep)) throw new Error(t('ce.sleep', { v: p.sleep }));
    for (const e of p.effects) {
      if (e.brightness > MAX_LEVEL || e.speed > MAX_LEVEL || e.color > 7) throw new Error(t('ce.params', { ui: e.ui }));
    }
    cfg.led = b;
  }
  if (obj.rgb !== undefined) {
    const b = fromHex(obj.rgb, 512, t('cw.rgb'));
    if (!rgbSignatureOk(b)) throw new Error(t('ce.sig', { what: t('cw.rgb') }));
    cfg.rgb = b;
  }
  for (const l of CONFIG_LAYERS) {
    const s = obj.layers?.[l];
    if (s === undefined) continue;
    const what = t(`bk.layer${l}`);
    const m = fromHex(s, MATRIX_SIZE, what);
    if (!matrixSignatureOk(m)) throw new Error(t('ce.sig', { what }));
    for (const k of KEYS) {
      const d = decode(getSlot(m, k.slot));
      if (d.kind === 'macro') throw new Error(t('ce.macro', { what, key: k.name }));
      if (d.kind === 'fn' && d.name !== FN_KEYS[0].name) throw new Error(t('ce.fn', { what, key: k.name, fn: d.name }));
    }
    if (l === 0 && decode(getSlot(m, SLOT.FN)).name !== FN_KEYS[0].name) throw new Error(t('ce.fnMissing'));
    cfg.layers[l] = m;
  }
  if (!cfg.led && !cfg.rgb && !Object.keys(cfg.layers).length) throw new Error(t('ce.empty'));
  return cfg;
}

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// 和键盘当前内容比较，说明导入会改什么。current = { led, rgb, layers: { 0, 1 } }
// 返回 { parts: [{ part, title, lines }], locked: ['默认层 F1', …] }；parts 只含真的有变化的部分。
// locked 非空时界面应拒绝导入（F1–F12、Fn 暂不允许改）
export function diffConfig(current, cfg) {
  const parts = [], locked = [];
  if (cfg.led) {
    const next = copyLed(current.led, cfg.led);
    if (!sameBytes(next, current.led)) {
      const a = parseLed(current.led), b = parseLed(next), lines = [];
      if (a.effect !== b.effect) lines.push(t('df.effect', { a: effectLabel(a.effect), b: effectLabel(b.effect) }));
      const n = a.effects.filter((e, i) => ['brightness', 'speed', 'color'].some(k => e[k] !== b.effects[i][k])).length;
      if (n) lines.push(t('df.params', { n }));
      if (a.debounce !== b.debounce) lines.push(t('df.debounce', { a: debounceLabel(a.debounce), b: debounceLabel(b.debounce) }));
      if (a.sleep !== b.sleep) lines.push(t('df.sleep', { a: sleepLabel(a.sleep), b: sleepLabel(b.sleep) }));
      parts.push({ part: 'led', title: t('df.ledTitle'), lines });
    }
  }
  if (cfg.rgb) {
    const next = copyRgb(current.rgb, cfg.rgb);
    if (!sameBytes(next, current.rgb)) {
      const a = rgbSegment(current.rgb, RGB_SEGMENTS[0]), b = rgbSegment(next, RGB_SEGMENTS[0]);
      const n = a.filter((c, i) => !sameBytes(c, b[i])).length;
      parts.push({ part: 'rgb', title: t('bkt.rgb'), lines: [n ? t('df.colors', { n }) : t('df.unify')] });
    }
  }
  for (const l of CONFIG_LAYERS) {
    if (!cfg.layers[l]) continue;
    const changed = KEYS.filter(k => !sameBytes(getSlot(current.layers[l], k.slot), getSlot(cfg.layers[l], k.slot)));
    if (!changed.length) continue;
    const layerName = t(`layer.${l}`);
    for (const k of changed) if (OFFICIAL_LOCKED.has(k.name)) locked.push(`${layerName} ${k.name}`);
    const names = changed.map(k => k.name);
    parts.push({ part: `layer${l}`, title: t('bkt.keys', { layer: layerName }), lines: [
      t('df.keys', { n: changed.length, names: names.slice(0, 10).join(t('sep')), more: names.length > 10 ? t('df.more') : '' }),
    ] });
  }
  return { parts, locked };
}

// 导入时各部分用的拷贝函数（只拷允许改的部分）
export const IMPORT_COPY = {
  led: (cur, cfg) => copyLed(cur, cfg.led),
  rgb: (cur, cfg) => copyRgb(cur, cfg.rgb),
  layer0: (cur, cfg) => copyMatrix(cur, cfg.layers[0]),
  layer1: (cur, cfg) => copyMatrix(cur, cfg.layers[1]),
};
