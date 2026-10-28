import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encode, decode, applyMatrix, checkMatrixWrite, matrixSignatureOk, getSlot,
  KEYS, SLOT, MEDIA, MOUSE, COMMANDS, LIGHT, FN_KEYS, MATRIX_SIZE,
} from './keycodes.js';
import { Keyboard, CMD } from './protocol.js';

// 2026-10-25 实机导出的 4 层矩阵（这份文件里 layers 是对的，psd/led 错位了 1 字节）
const dump = JSON.parse(readFileSync(new URL('../tools/dump-2026-10-25-wired.json', import.meta.url), 'utf8'));
const LAYER = dump.layers.map(s => Uint8Array.from(s.trim().split(/\s+/), h => parseInt(h, 16)));
const le = v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF];
const at = (layer, name) => getSlot(LAYER[layer], SLOT[name]);

test('实机矩阵：4 层签名都对', () => {
  for (const m of LAYER) assert.ok(matrixSignatureOk(m));
  assert.equal(KEYS.length, 87);
  assert.equal(new Set(KEYS.map(k => k.slot)).size, 87);
});

test('实机默认层：每个键都能解码，并且都有确定的含义', () => {
  for (const k of KEYS) {
    const d = decode(at(0, k.name));
    assert.ok(d.sure, `${k.name}: ${d.name}`);
    assert.notEqual(d.kind, 'unknown', k.name);
  }
  assert.equal(decode(at(0, 'Esc')).name, 'Esc');
  assert.equal(decode(at(0, 'LShift')).kind, 'mods');
  assert.equal(decode(at(0, 'LShift')).name, 'LShift');
  assert.equal(decode(at(0, 'RAlt')).name, 'RAlt');
  assert.equal(decode(at(0, 'FN')).name, 'FN1');
  assert.equal(decode(at(0, 'Pause')).name, '播放/暂停', '出厂把 Pause 设成了播放/暂停');
});

test('实机 FN1 层：和 KB.ini [FN1] 的含义对得上', () => {
  const name = n => decode(at(1, n)).name;
  assert.equal(name('Esc'), '复位键盘');
  assert.equal(name('LWin'), '锁 Win 键');
  assert.equal(name('W'), '切换到 Windows 模式（Fn+W）');
  assert.equal(name('F1'), '屏幕亮度 -');
  assert.equal(name('F2'), '屏幕亮度 +');
  assert.equal(name('F3'), 'LAlt+Tab');
  assert.equal(name('F8'), '播放/暂停');
  assert.equal(name('Insert'), '切换灯效');
  assert.equal(name('Delete'), '切换颜色');
  assert.equal(name('Up'), '亮度 +');
  assert.equal(name('Down'), '亮度 -');
  assert.equal(name('Right'), '速度 +');
  assert.equal(name('Left'), '速度 -');
  assert.equal(decode(at(1, 'A')).kind, 'none');
  // 对照纸质说明书
  assert.equal(name('1'), '蓝牙设备 1（长按 3 秒配对）');
  assert.equal(name('3'), '蓝牙设备 3（长按 3 秒配对）');
  assert.equal(name('`'), '2.4G 模式（长按 3 秒配对）');
  assert.equal(name('Q'), '切换到 Android 模式（Fn+Q）');
  assert.equal(name('E'), '切换到 Mac 模式（Fn+E）');
  assert.equal(name('R'), '切换到 iOS 模式（Fn+R）');
  assert.equal(name('B'), '灯带显示电量');
  assert.equal(name('RShift'), '侧灯：切换灯效');
  assert.equal(name('/'), '侧灯：切换颜色');
  assert.equal(name('RAlt'), '侧灯：切换亮度');
  assert.equal(name('RCtrl'), '侧灯：切换速度');
  assert.equal(name('LShift'), '灯带：切换灯效');
  assert.equal(name('Z'), '灯带：切换颜色');
  assert.equal(name('LCtrl'), '灯带：切换速度');
  // 出厂 FN1 层只剩 Fn+G 含义不确定
  assert.deepEqual(KEYS.filter(k => !decode(at(1, k.name)).sure).map(k => k.name), ['G']);
});

test('encode 与官方 keyinfo_to_hardware_code 的返回值一致（小端）', () => {
  const official = [
    // 鼠标（键盘设备，前进/后退已互换）
    [MOUSE.find(m => m.name === '左键').bytes, 0x10101],
    [MOUSE.find(m => m.name === '右键').bytes, 0x10201],
    [MOUSE.find(m => m.name === '中键').bytes, 0x10301],
    [MOUSE.find(m => m.name === '前进').bytes, 0x10501],
    [MOUSE.find(m => m.name === '后退').bytes, 0x10401],
    [MOUSE.find(m => m.name === '左键双击').bytes, 0x20101],
    [MOUSE.find(m => m.name === '左键三连发').bytes, 0x32030101],
    [MOUSE.find(m => m.name === '滚轮上').bytes, 0x801],
    [MOUSE.find(m => m.name === '滚轮下').bytes, 0x901],
    // 常用命令
    ...[0x3d0400, 0xf0800, 0x150800, 0x2e0100, 0x2d0100, 0x70800, 0x4c0500, 0x1d0100, 0x160100, 0,
      0x1000007, 0x2000007, 0x4000007].map((v, i) => [COMMANDS[i].bytes, v]),
    // 灯光 / Fn
    [LIGHT[0].bytes, 8], [FN_KEYS[0].bytes, 0xd], [FN_KEYS[1].bytes, 0x10d],
  ];
  for (const [bytes, v] of official) assert.deepEqual([...encode({ kind: 'raw', bytes })], le(v));
  // 多媒体
  const media = { 0xCD: 0xcd000002, 0xB7: 0xb7000002, 0xB6: 0xb6000002, 0xB5: 0xb5000002, 0xE9: 0xe9000002,
    0xEA: 0xea000002, 0xE2: 0xe2000002, 0x6F: 0x6f000002, 0x70: 0x70000002, 0x18A: 0x8a010002,
    0x192: 0x92010002, 0x194: 0x94010002, 0x223: 0x23020002, 0x22A: 0x2a020002, 0x183: 0x83010002 };
  for (const [u, v] of Object.entries(media)) assert.deepEqual([...encode({ kind: 'media', usage: +u })], le(v));
  // 键盘：[00 修饰键 键2 键1]
  assert.deepEqual([...encode({ kind: 'key', key: 0x2C })], [0, 0, 0, 0x2C]);
  assert.deepEqual([...encode({ kind: 'key', key: 0x06, mods: 0x01 })], [0, 1, 0, 0x06]);
  assert.deepEqual([...encode({ kind: 'mods', mods: 0x02 })], [0, 2, 0, 0]);
  // 宏：模式 0/1/2（界面）→ 1/2/4
  assert.deepEqual([...encode({ kind: 'macro', index: 0, mode: 1, count: 5 })], [3, 1, 5, 0]);
  assert.deepEqual([...encode({ kind: 'macro', index: 2, mode: 4, count: 9 })], [3, 4, 1, 2]);
});

test('所有表项编码后再解码，名称不变', () => {
  for (const e of [...MOUSE, ...COMMANDS, ...LIGHT, ...FN_KEYS]) {
    const d = decode(encode({ kind: 'raw', bytes: e.bytes }));
    assert.ok(d.name.startsWith(e.name), `${e.name} → ${d.name}`);
  }
  for (const m of MEDIA) assert.equal(decode(encode({ kind: 'media', usage: m.usage })).name, m.name);
  assert.equal(decode(Uint8Array.of(3, 2, 1, 4)).name, '宏 #5（循环直到按键松开）');
});

test('encode 拒绝无效输入', () => {
  assert.throws(() => encode({ kind: 'key', key: 0xFF }), /用法码/);
  assert.throws(() => encode({ kind: 'macro', index: 0, mode: 3 }), /模式/);
  assert.throws(() => encode({ kind: 'macro', index: 0, count: 0 }), /次数/);
  assert.throws(() => encode({ kind: 'raw', bytes: [1, 2, 3] }), /4 个字节/);
  assert.throws(() => encode({ kind: 'mods', mods: 256 }), /0–255/);
});

test('applyMatrix 只改目标槽位，checkMatrixWrite 拦截其他改动', () => {
  const next = applyMatrix(LAYER[0], { CapsLock: { kind: 'key', key: 0xE0 }, App: { kind: 'media', usage: 0xCD } });
  const diff = [];
  for (let s = 0; s < 128; s++) if (getSlot(next, s).some((v, i) => v !== getSlot(LAYER[0], s)[i])) diff.push(s);
  assert.deepEqual(diff, [SLOT.CapsLock, SLOT.App]);
  checkMatrixWrite(LAYER[0], next);
  assert.equal(LAYER[0][SLOT.CapsLock * 4 + 3], 0x39, '原数组不能被修改');

  const stray = Uint8Array.from(LAYER[0]); stray[6 * 4 + 3] = 0x04; // 槽位 6 不对应任何键
  assert.throws(() => checkMatrixWrite(LAYER[0], stray), /槽位 6/);
  const noSig = Uint8Array.from(LAYER[0]); noSig[127 * 4 + 3] = 0;
  assert.throws(() => checkMatrixWrite(LAYER[0], noSig), /签名/);
  assert.throws(() => applyMatrix(LAYER[0], { Numpad1: { kind: 'none' } }), /没有这个键/);
});

// 模拟键盘：矩阵回复 520 字节（与实机相同）
function fakeMatrixDevice(layers) {
  const mem = layers.map(l => Uint8Array.from(l));
  let pending = null;
  const sent = [];
  return {
    sent, mem,
    async sendFeatureReport(id, data) {
      assert.equal(id, 0x06);
      sent.push(Uint8Array.from(data));
      if (data[0] === CMD.SET_MATRIX) mem[data[1]] = Uint8Array.from(data.subarray(7, 7 + 512));
      else pending = [data[0], data[1]];
    },
    async receiveFeatureReport() {
      const r = new Uint8Array(520);
      r.set([0x06, pending[0], pending[1], 0, 1, 0, 0x00, 0x02]);
      r.set(mem[pending[1]], 8);
      return new DataView(r.buffer);
    },
  };
}
const noDelay = async () => {};

test('writeMatrix：读、备份、整层写入、读回校验', async () => {
  const dev = fakeMatrixDevice(LAYER);
  const kb = new Keyboard(dev, { delay: noDelay });
  let backup = null;
  const res = await kb.writeMatrix(2, cur => applyMatrix(cur, { A: { kind: 'key', key: 0x1E } }),
    { onBackup: b => { backup = b; } });
  assert.equal(res.written, true);
  assert.deepEqual(backup, LAYER[2]);
  assert.deepEqual([...getSlot(dev.mem[2], SLOT.A)], [0, 0, 0, 0x1E]);
  assert.ok(matrixSignatureOk(dev.mem[2]));
  const writes = dev.sent.filter(f => f[0] === CMD.SET_MATRIX);
  assert.equal(writes.length, 1);
  assert.deepEqual([...writes[0].subarray(0, 7)], [0x03, 2, 0, 1, 0, 0x00, 0x02]);
  assert.deepEqual(dev.mem[0], LAYER[0], '其他层不受影响');
});

test('writeMatrix：检查不通过时一个写入都不发', async () => {
  const dev = fakeMatrixDevice(LAYER);
  const kb = new Keyboard(dev, { delay: noDelay });
  await assert.rejects(kb.writeMatrix(0, cur => { const m = Uint8Array.from(cur); m[MATRIX_SIZE - 1] = 0; return m; }), /签名/);
  await assert.rejects(kb.writeMatrix(4, cur => cur), /层号/);
  assert.ok(dev.sent.every(f => f[0] === CMD.GET_MATRIX));
});
