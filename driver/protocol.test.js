import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseLed, applyLed, checkLedWrite, buildFrame, stripReply, Keyboard, LED, CMD, SUPPORTED_EFFECTS, SLEEP_OPTIONS, isSupported,
  RGB, RGB_SEGMENTS, DEFAULT_PALETTE, rgbSignatureOk, rgbSegment, applyPalette, checkRgbWrite,
} from './protocol.js';

// 2026-10-25 从实机读到的灯效块（当前灯效 11，休眠 10）
const REAL = Uint8Array.from((
  '00 03 03 01 00 00 04 04 07 00 0B 20 00 00 00 00 ' +
  '00 00 02 00 02 01 00 FF 0A 00 00 00 01 FF 02 01 ' +
  '00 FF 00 FF 00 FF FF FF FF FF 00 00 00 00 00 00 ' +
  '00 00 00 00 00 00 00 00 FF FF 04 47 04 47 04 47 ' +
  '04 47 04 47 04 47 04 47 04 47 04 47 04 47 04 47 ' +
  '04 47 04 47 04 47 04 47 04 47 04 37 04 37 04 37 ' +
  '04 37 07 47 07 47 07 44 07 44 07 44 07 44 07 44 ' +
  '07 44 07 44 04 04 04 04 04 04 04 04 04 04 5A A5'
).trim().split(/\s+/).map(h => parseInt(h, 16)));

test('parseLed 读出实机数据', () => {
  const p = parseLed(REAL);
  assert.equal(p.sigOk, true);
  assert.equal(p.effect, 11);
  assert.equal(p.sleep, 10);
  assert.deepEqual(p.effects[10], { ui: 11, brightness: 4, speed: 4, color: 7 });
  assert.deepEqual(p.effects[14], { ui: 15, brightness: 4, speed: 4, color: 7 });
  assert.deepEqual(p.effects[16], { ui: 17, brightness: 4, speed: 3, color: 7 });
});

test('applyLed 只改指定字段', () => {
  const next = applyLed(REAL, { effect: 2, params: { 2: { brightness: 2, speed: 1, color: 0 } } });
  const diff = [];
  for (let i = 0; i < 128; i++) if (next[i] !== REAL[i]) diff.push(i);
  assert.deepEqual(diff, [0x0A, 0x3C, 0x3D]);
  assert.equal(next[0x0A], 2);
  assert.equal(next[0x3C], 2);
  assert.equal(next[0x3D], 0x10);
  assert.equal(REAL[0x0A], 11, '原数组不能被修改');
});

test('applyLed 拒绝越界数值', () => {
  assert.throws(() => applyLed(REAL, { params: { 1: { brightness: 5 } } }), /亮度/);
  assert.throws(() => applyLed(REAL, { params: { 1: { color: 8 } } }), /颜色/);
  assert.throws(() => applyLed(REAL, { effect: 19 }), /灯效/);
});

test('LedMask 隐藏 6、9、14、18', () => {
  assert.deepEqual([6, 9, 14, 18].map(isSupported), [false, false, false, false]);
  assert.equal(SUPPORTED_EFFECTS.length, 14);
  assert.ok(!SUPPORTED_EFFECTS.some(e => [6, 9, 14, 18].includes(e.ui)));
  assert.throws(() => applyLed(REAL, { effect: 9 }), /不被这把键盘支持/);
  // 参数槽仍可写（还原备份时会带上全部槽位），只是不能切换过去
  applyLed(REAL, { params: { 9: { brightness: 3 } } });
});

test('checkLedWrite 拦截不允许的字节和坏签名', () => {
  const ok = applyLed(REAL, { effect: 1 });
  checkLedWrite(REAL, ok);
  // 0x16 / 0x17 是官方程序另外管理的字节，网页版不改
  const other = Uint8Array.from(REAL); other[0x17] = 1;
  assert.throws(() => checkLedWrite(REAL, other), /0x17/);
  const noSig = Uint8Array.from(REAL); noSig[0x7F] = 0;
  assert.throws(() => checkLedWrite(REAL, noSig), /签名/);
});

test('防抖：0x03，硬件值 0–4，实机出厂是 1', () => {
  assert.equal(parseLed(REAL).debounce, 1);
  const next = applyLed(REAL, { debounce: 3 });
  const diff = [];
  for (let i = 0; i < 128; i++) if (next[i] !== REAL[i]) diff.push(i);
  assert.deepEqual(diff, [LED.DEBOUNCE]);
  assert.equal(next[0x03], 3);
  checkLedWrite(REAL, next);
  assert.throws(() => applyLed(REAL, { debounce: 5 }), /防抖/);
  assert.throws(() => applyLed(REAL, { debounce: -1 }), /防抖/);
  const bad = Uint8Array.from(REAL); bad[LED.DEBOUNCE] = 9;
  assert.throws(() => checkLedWrite(REAL, bad), /0x3（防抖）/);
});

test('休眠：0x18，只接受 SleepHW 里的值', () => {
  const next = applyLed(REAL, { sleep: 20 });
  assert.equal(next[LED.SLEEP], 20);
  checkLedWrite(REAL, next);
  assert.deepEqual(SLEEP_OPTIONS.map(o => o.hw), [2, 3, 4, 6, 8, 10, 20, 30, 40]);
  assert.throws(() => applyLed(REAL, { sleep: 5 }), /休眠/);
  const bad = Uint8Array.from(REAL); bad[LED.SLEEP] = 1;
  assert.throws(() => checkLedWrite(REAL, bad), /0x18（休眠）/);
});

test('不加入恢复出厂命令 0x11', () => {
  assert.ok(!Object.values(CMD).includes(0x11));
});

// 2026-10-27 实机读到的颜色表（0x8A）
const RGB_DUMP = JSON.parse(readFileSync(new URL('../tools/dump-2026-10-27-wired-rgb.json', import.meta.url), 'utf8'));
const REAL_RGB = Uint8Array.from(RGB_DUMP.rgb.trim().split(/\s+/), h => parseInt(h, 16));

test('颜色表：实机数据和官方写入格式一致', () => {
  assert.equal(RGB_DUMP.rgbReplyLength, 512);
  assert.ok(rgbSignatureOk(REAL_RGB), '签名在 0x1FA');
  assert.deepEqual(rgbSegment(REAL_RGB, 0), Array(7).fill([0, 0, 0]), '第 0 段空');
  for (let n = 1; n <= 13; n++) assert.deepEqual(rgbSegment(REAL_RGB, n), DEFAULT_PALETTE, `段 ${n} = 出厂调色板（R、G、B 顺序）`);
  for (let n = 14; n <= 23; n++) assert.deepEqual(rgbSegment(REAL_RGB, n), Array(7).fill([0, 0, 0]), `段 ${n} 空`);
  assert.deepEqual(RGB_SEGMENTS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test('颜色表：applyPalette 给第 1–13 段写同一套颜色，其他字节不动', () => {
  const pal = DEFAULT_PALETTE.map(() => [1, 2, 3]);
  pal[6] = [10, 20, 30];
  const next = applyPalette(REAL_RGB, pal);
  for (const n of RGB_SEGMENTS) assert.deepEqual(rgbSegment(next, n), pal, `段 ${n}`);
  const diff = [];
  for (let i = 0; i < RGB.SIZE; i++) if (next[i] !== REAL_RGB[i]) diff.push(i);
  assert.ok(diff.every(i => i >= 0x15 && i < 14 * 0x15), '只改第 1–13 段');
  checkRgbWrite(REAL_RGB, next);
  assert.equal(REAL_RGB[0x15], 255, '原数组不能被修改');
  assert.throws(() => applyPalette(REAL_RGB, pal.slice(0, 6)), /7 种颜色/);
  assert.throws(() => applyPalette(REAL_RGB, [...pal.slice(0, 6), [256, 0, 0]]), /0–255/);
});

test('颜色表：checkRgbWrite 拦截段外改动和坏签名', () => {
  const seg0 = Uint8Array.from(REAL_RGB); seg0[0x01] = 9;
  assert.throws(() => checkRgbWrite(REAL_RGB, seg0), /0x1 不在/);
  const seg14 = Uint8Array.from(REAL_RGB); seg14[14 * 0x15] = 9;
  assert.throws(() => checkRgbWrite(REAL_RGB, seg14), /0x126/);
  const noSig = Uint8Array.from(REAL_RGB); noSig[0x1FB] = 0;
  assert.throws(() => checkRgbWrite(REAL_RGB, noSig), /签名/);
});

// 模拟键盘：颜色表回复 520 字节（与实机相同）
function fakeRgbDevice(initial) {
  let rgb = Uint8Array.from(initial);
  const sent = [];
  return {
    sent,
    get rgb() { return rgb; },
    async sendFeatureReport(id, data) {
      assert.equal(id, 0x06);
      sent.push(Uint8Array.from(data));
      if (data[0] === CMD.SET_RGB) rgb = Uint8Array.from(data.subarray(7, 7 + 512));
    },
    async receiveFeatureReport() {
      const r = new Uint8Array(520);
      r.set([0x06, 0x8A, 0, 0, 1, 0, 0x00, 0x02]);
      r.set(rgb, 8);
      return new DataView(r.buffer);
    },
  };
}

test('writeRgb：读、备份、整块写入、读回校验', async () => {
  const dev = fakeRgbDevice(REAL_RGB);
  const pal = DEFAULT_PALETTE.map(c => c.slice());
  pal[0] = [255, 128, 0];
  let backup = null;
  const res = await new Keyboard(dev, { delay: noDelay }).writeRgb(cur => applyPalette(cur, pal), { onBackup: b => { backup = b; } });
  assert.equal(res.written, true);
  assert.deepEqual(backup, REAL_RGB);
  for (const n of RGB_SEGMENTS) assert.deepEqual(rgbSegment(dev.rgb, n), pal);
  const writes = dev.sent.filter(f => f[0] === CMD.SET_RGB);
  assert.equal(writes.length, 1);
  assert.deepEqual([...writes[0].subarray(0, 7)], [0x0A, 0, 0, 1, 0, 0x00, 0x02]);
  assert.ok(dev.sent.every(f => [0x8A, 0x0A].includes(f[0])));
});

test('writeRgb：检查不通过时一个写入都不发', async () => {
  const dev = fakeRgbDevice(REAL_RGB);
  await assert.rejects(new Keyboard(dev, { delay: noDelay }).writeRgb(cur => { const b = Uint8Array.from(cur); b[0x1FA] = 0; return b; }), /签名/);
  assert.ok(dev.sent.every(f => f[0] === 0x8A));
});

test('buildFrame 和 stripReply', () => {
  const f = buildFrame(0x04, 0, 1, 0, 128, REAL);
  assert.equal(f.length, 519);
  assert.deepEqual([...f.subarray(0, 7)], [0x04, 0, 0, 1, 0, 0x80, 0]);
  assert.equal(f[7 + 0x7E], 0x5A);
  const withId = Uint8Array.of(0x06, 0x84, 0, 0, 1, 0, 0x80, 0, 0xAA);
  assert.equal(stripReply(withId, 0x84)[7], 0xAA);
  const noId = Uint8Array.of(0x84, 0, 0, 1, 0, 0x80, 0, 0xAA);
  assert.equal(stripReply(noId, 0x84)[7], 0xAA);
  assert.throws(() => stripReply(Uint8Array.of(0x06, 0x83, 0), 0x84), /回显/);
});

// 模拟键盘：灯效块回复 136 字节（与实机相同），记录写入
function fakeDevice(initial) {
  let led = Uint8Array.from(initial);
  let pending = null;
  const sent = [];
  return {
    sent,
    get led() { return led; },
    async sendFeatureReport(id, data) {
      assert.equal(id, 0x06);
      sent.push(Uint8Array.from(data));
      if (data[0] === CMD.SET_LED) led = Uint8Array.from(data.subarray(7, 7 + 128));
      else pending = data[0];
    },
    async receiveFeatureReport(id) {
      assert.equal(id, 0x06);
      const r = new Uint8Array(136);
      r.set([0x06, pending, 0, 0, 1, 0, 0x80, 0]);
      r.set(led, 8);
      return new DataView(r.buffer);
    },
  };
}
const noDelay = async () => {};

test('writeLed：先读、备份、写入、读回校验', async () => {
  const dev = fakeDevice(REAL);
  const kb = new Keyboard(dev, { delay: noDelay });
  let backup = null;
  const res = await kb.writeLed(cur => applyLed(cur, { effect: 3, params: { 3: { brightness: 1 } } }),
    { onBackup: b => { backup = Uint8Array.from(b); } });
  assert.equal(res.written, true);
  assert.deepEqual(backup, REAL);
  assert.equal(dev.led[0x0A], 3);
  assert.equal(dev.led[0x3E], 1);
  const writes = dev.sent.filter(f => f[0] === CMD.SET_LED);
  assert.equal(writes.length, 1);
  assert.deepEqual([...writes[0].subarray(0, 7)], [0x04, 0, 0, 1, 0, 0x80, 0]);
  assert.ok(dev.sent.every(f => [0x84, 0x04].includes(f[0])), '只允许发送 0x84 和 0x04');
});

test('writeLed：没有变化就不写', async () => {
  const dev = fakeDevice(REAL);
  const res = await new Keyboard(dev, { delay: noDelay }).writeLed(cur => Uint8Array.from(cur));
  assert.equal(res.written, false);
  assert.ok(dev.sent.every(f => f[0] === 0x84));
});

test('writeLed：防抖写入后读回一致', async () => {
  const dev = fakeDevice(REAL);
  const res = await new Keyboard(dev, { delay: noDelay }).writeLed(cur => applyLed(cur, { debounce: 0 }));
  assert.equal(res.written, true);
  assert.equal(dev.led[LED.DEBOUNCE], 0);
  assert.ok(dev.sent.every(f => [0x84, 0x04].includes(f[0])));
});

test('writeLed：检查不通过时一个写入都不发', async () => {
  const dev = fakeDevice(REAL);
  const kb = new Keyboard(dev, { delay: noDelay });
  await assert.rejects(kb.writeLed(cur => { const b = Uint8Array.from(cur); b[0x18] = 1; return b; }), /0x18/);
  assert.ok(dev.sent.every(f => f[0] === 0x84));
});
