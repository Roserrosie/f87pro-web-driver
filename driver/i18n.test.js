import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STR, t, setLang, getLang } from './i18n.js';
import { EFFECTS, COLORS } from './protocol.js';
import { LAYERS, MEDIA, MOUSE, COMMANDS, LIGHT, BUILTIN, MACRO_MODES, decode, encode } from './keycodes.js';
import { sleepLabel, debounceLabel } from './config.js';

const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const src = f => readFileSync(new URL(f, import.meta.url), 'utf8');

test('每条文字都有中英文，两边的 {参数} 一致', () => {
  for (const [key, pair] of Object.entries(STR)) {
    assert.equal(pair.length, 2, key);
    assert.ok(pair[0] && pair[1], `${key} 有空文字`);
    assert.deepEqual(placeholders(pair[1]), placeholders(pair[0]), `${key} 的参数不一致`);
  }
});

test('代码和页面里用到的文字 key 都在文字表里', () => {
  const files = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'i18n.js');
  const used = new Set();
  for (const f of files) {
    const s = src(f);
    for (const m of s.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
    // banner('ok', 'bn.x')、备份说明 'note.x'、手动选择分组 'hg.x'、写入完成 ['bn.x', …]
    for (const m of s.matchAll(/'((?:bn|note|hg)\.\w+)'/g)) used.add(m[1]);
  }
  for (const m of src('index.html').matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
  // 拼出来的 key：bk.${kind}、bktag.${kind}、layer.${l}
  for (const k of ['led', 'rgb', 'layer0', 'layer1']) used.add(`bk.${k}`).add(`bktag.${k}`);
  used.add('layer.0').add('layer.1');
  const missing = [...used].filter(k => !STR[k]);
  assert.deepEqual(missing, []);
});

test('数据表都有英文名', () => {
  const tables = { EFFECTS, COLORS, LAYERS, MEDIA, MOUSE, COMMANDS, LIGHT, BUILTIN: Object.values(BUILTIN), MACRO_MODES: Object.values(MACRO_MODES) };
  for (const [name, list] of Object.entries(tables)) {
    for (const e of list) assert.ok(e.en, `${name}：${e.name} 没有英文名`);
  }
});

test('切到英文后，键名、标签、报错都是英文', () => {
  assert.equal(getLang(), 'zh');
  setLang('en');
  try {
    assert.equal(decode(Uint8Array.of(0x02, 0, 0, 0xCD)).name, 'Play/Pause');
    assert.equal(decode(Uint8Array.of(0, 0x04, 0x3D, 0)).name, 'Close window (LAlt+F4)');
    assert.equal(decode(Uint8Array.of(0x08, 0x03, 0x01, 0x01)).name, 'Side light: brightness +');
    assert.equal(decode(Uint8Array.of(3, 2, 1, 4)).name, 'Macro #5 (loop until released)');
    assert.equal(decode(Uint8Array.of(0, 0, 0, 0)).name, 'No function');
    assert.equal(sleepLabel(10), '5 min');
    assert.equal(debounceLabel(1), 'Level 2');
    assert.equal(t('bn.restored', { when: 'X' }), 'Restored the backup from X.');
    assert.throws(() => encode({ kind: 'raw', bytes: [1] }), /must be 4 bytes/);
    setLang('xx');
    assert.equal(getLang(), 'en', '不认识的语言不切换');
  } finally {
    setLang('zh');
  }
  assert.equal(decode(Uint8Array.of(0x02, 0, 0, 0xCD)).name, '播放/暂停');
});

test('不认识的 key 原样返回（报错信息可以直接传给横幅）', () => {
  assert.equal(t('Some error message'), 'Some error message');
  assert.equal(t('dirty.keys', { n: 3 }), '未应用的修改：3 个键');
});
