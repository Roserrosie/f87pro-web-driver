import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACTORY_LED, FACTORY_LAYERS, factoryLed, factoryRgb, factoryMatrix, factoryReset } from './factory.js';
import {
  Keyboard, CMD, LED, parseLed, applyLed, checkLedWrite, ledSignatureOk, isSupported,
  DEFAULT_PALETTE, applyPalette, checkRgbWrite,
} from './protocol.js';
import { SLOT, getSlot, decode, applyMatrix, checkMatrixWrite, matrixSignatureOk } from './keycodes.js';

const load = f => JSON.parse(readFileSync(new URL(`../tools/${f}`, import.meta.url), 'utf8'));
const bytes = s => Uint8Array.from(s.trim().split(/\s+/), h => parseInt(h, 16));
const LAYER = load('dump-2026-10-25-wired.json').layers.map(bytes);
const REAL_RGB = bytes(load('dump-2026-10-27-wired-rgb.json').rgb);

test('出厂灯效块和官方默认值一致', () => {
  assert.ok(ledSignatureOk(FACTORY_LED));
  const p = parseLed(FACTORY_LED);
  assert.equal(p.effect, 11, 'DefLedIndex=10 是 0 基下标 → LedOpt11');
  assert.ok(isSupported(p.effect));
  assert.equal(p.sleep, 10, 'SleepTime=300 → 10');
  assert.equal(p.debounce, 1, 'ShowDebounce 默认 1');
  // 官方恢复会写的 14 个槽：亮度 4、速度 4、多彩
  for (let ui = 1; ui <= 14; ui++) assert.deepEqual(p.effects[ui - 1], { ui, brightness: 4, speed: 4, color: 7 });
});

test('出厂矩阵就是实机导出的默认层和 FN1 层', () => {
  assert.deepEqual(FACTORY_LAYERS[0], LAYER[0]);
  assert.deepEqual(FACTORY_LAYERS[1], LAYER[1]);
  assert.ok(matrixSignatureOk(FACTORY_LAYERS[0]) && matrixSignatureOk(FACTORY_LAYERS[1]));
  assert.equal(decode(getSlot(FACTORY_LAYERS[0], SLOT.Pause)).name, '播放/暂停');
  assert.equal(decode(getSlot(FACTORY_LAYERS[1], SLOT.Esc)).name, '复位键盘');
  assert.equal(FACTORY_LAYERS[2], undefined, '第 2、3 层不恢复');
});

test('factoryLed 只恢复允许修改的字节，其他原样保留', () => {
  const changed = applyLed(FACTORY_LED, { effect: 2, debounce: 4, sleep: 40, params: { 2: { brightness: 1, speed: 0, color: 3 }, 17: { speed: 4 } } });
  changed[0x17] = 0x55; // 不归网页版管的字节
  const back = factoryLed(changed);
  const expected = Uint8Array.from(FACTORY_LED); expected[0x17] = 0x55;
  assert.deepEqual(back, expected);
  checkLedWrite(changed, back);
  assert.equal(changed[LED.EFFECT], 2, '原数组不能被修改');
});

test('factoryMatrix 只恢复按键槽位，不碰空槽和签名', () => {
  const changed = applyMatrix(LAYER[0], { CapsLock: { kind: 'key', key: 0xE0 }, A: { kind: 'none' } });
  changed[6 * 4 + 3] = 0x77; // 槽位 6 不对应任何键
  const back = factoryMatrix(changed, 0);
  const expected = Uint8Array.from(LAYER[0]); expected[6 * 4 + 3] = 0x77;
  assert.deepEqual(back, expected);
  checkMatrixWrite(changed, back);
  assert.throws(() => factoryMatrix(LAYER[2], 2), /默认层和 FN1 层/);
});

test('factoryRgb 把颜色换回出厂调色板，等于实机读到的出厂颜色表', () => {
  const changed = applyPalette(REAL_RGB, DEFAULT_PALETTE.map(() => [9, 9, 9]));
  const back = factoryRgb(changed);
  assert.deepEqual(back, REAL_RGB);
  checkRgbWrite(changed, back);
});

// 模拟键盘：灯效块（回复 136 字节）、颜色表和 4 层矩阵（回复 520 字节）
function fakeKeyboard(led, layers, rgb = REAL_RGB) {
  const mem = { led: Uint8Array.from(led), rgb: Uint8Array.from(rgb), layers: layers.map(l => Uint8Array.from(l)) };
  let pending = null;
  const sent = [];
  return {
    sent, mem,
    async sendFeatureReport(id, data) {
      assert.equal(id, 0x06);
      sent.push(Uint8Array.from(data));
      if (data[0] === CMD.SET_LED) mem.led = Uint8Array.from(data.subarray(7, 7 + 128));
      else if (data[0] === CMD.SET_RGB) mem.rgb = Uint8Array.from(data.subarray(7, 7 + 512));
      else if (data[0] === CMD.SET_MATRIX) mem.layers[data[1]] = Uint8Array.from(data.subarray(7, 7 + 512));
      else pending = [data[0], data[1]];
    },
    async receiveFeatureReport() {
      const [cmd, sub] = pending;
      const body = cmd === CMD.GET_LED ? mem.led : cmd === CMD.GET_RGB ? mem.rgb : mem.layers[sub];
      const r = new Uint8Array(8 + body.length);
      r.set([0x06, cmd, sub, 0, 1, 0, body.length & 0xFF, body.length >> 8]);
      r.set(body, 8);
      return new DataView(r.buffer);
    },
  };
}
const noDelay = async () => {};

test('factoryReset：依次恢复灯效块、颜色表、默认层、FN1 层，不发 0x11', async () => {
  const led = applyLed(FACTORY_LED, { effect: 5, debounce: 0, sleep: 2 });
  const rgb = applyPalette(REAL_RGB, DEFAULT_PALETTE.map(() => [1, 2, 3]));
  const l0 = applyMatrix(LAYER[0], { CapsLock: { kind: 'key', key: 0xE0 } });
  const l1 = applyMatrix(LAYER[1], { A: { kind: 'key', key: 0x04 } });
  const l2 = applyMatrix(LAYER[2], { B: { kind: 'key', key: 0x05 } });
  const dev = fakeKeyboard(led, [l0, l1, l2, LAYER[3]], rgb);
  const parts = [];
  const res = await factoryReset(new Keyboard(dev, { delay: noDelay }), { onBackup: (part, b) => parts.push([part, Uint8Array.from(b)]) });

  assert.deepEqual(parts.map(p => p[0]), ['led', 'rgb', 'layer0', 'layer1']);
  assert.deepEqual(parts[0][1], led);
  assert.deepEqual(parts[1][1], rgb);
  assert.deepEqual(parts[2][1], l0);
  assert.ok(res.led.written && res.rgb.written && res.layer0.written && res.layer1.written);
  assert.deepEqual(dev.mem.led, FACTORY_LED);
  assert.deepEqual(dev.mem.rgb, REAL_RGB);
  assert.deepEqual(dev.mem.layers[0], LAYER[0]);
  assert.deepEqual(dev.mem.layers[1], LAYER[1]);
  assert.deepEqual(dev.mem.layers[2], l2, '第 2 层不受影响');
  assert.ok(dev.sent.every(f => [0x84, 0x04, 0x8A, 0x0A, 0x83, 0x03].includes(f[0])), '不发 0x11');
  assert.deepEqual(dev.sent.filter(f => [0x04, 0x0A, 0x03].includes(f[0])).map(f => f[0]), [0x04, 0x0A, 0x03, 0x03], '先灯效块再颜色表');
});

test('factoryReset：已经是出厂状态时一个写入都不发', async () => {
  const dev = fakeKeyboard(FACTORY_LED, LAYER);
  const res = await factoryReset(new Keyboard(dev, { delay: noDelay }));
  assert.ok(!res.led.written && !res.rgb.written && !res.layer0.written && !res.layer1.written);
  assert.ok(dev.sent.every(f => [0x84, 0x8A, 0x83].includes(f[0])));
});
