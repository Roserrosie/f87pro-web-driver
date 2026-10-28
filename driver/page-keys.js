// 按键页：默认层 / FN1 层的键盘图 + 改键面板。草稿 → 应用到键盘（writeMatrix 内部做 读 → 检查 → 写 → 读回核对）。

import {
  KEYS, SLOT, OFFICIAL_LOCKED, HID_NAMES, MODS, MOUSE, MEDIA, COMMANDS, LIGHT,
  encode, decode, getSlot, applyMatrix, copyMatrix, modBit, recordedAction, keyAction,
} from './keycodes.js';
import { FACTORY_LAYERS } from './factory.js';
import { LAYOUT, KB_W, KB_H } from './layout.js';
import { $, state, render, onRender, banner, withBusy, ask, addBackup, fromHex, fmtTime, el, log } from './ui.js';
import { t, L, getLang } from './i18n.js';

const layerName = l => t(`layer.${l}`);

// 菜单：键盘按键（录入 + 手动选择）以及来自 keycodes.js 的各类功能表。宏和 FN2 不提供，BUILTIN 里不确定的也不放。
// 分类标签的文字在 index.html（data-i18n="cat.*"）
const raw = e => ({ ...e, action: { kind: 'raw', bytes: e.bytes } });
const CATS = [
  { id: 'key' },
  { id: 'mouse', items: MOUSE.map(raw) },
  { id: 'media', items: MEDIA.map(m => ({ ...m, action: { kind: 'media', usage: m.usage } })) },
  { id: 'cmd', items: COMMANDS.map(c => ({ ...raw(c), official: true })) },
  { id: 'light', items: LIGHT.map(c => ({ ...raw(c), official: true })) },
];

// 手动选择的分组（第一项是文字 key）
const HID_GROUPS = [
  ['hg.letters', u => u >= 0x04 && u <= 0x1D],
  ['hg.digits', u => u >= 0x1E && u <= 0x27],
  ['hg.fkeys', u => (u >= 0x3A && u <= 0x45) || u === 0x68],
  ['hg.symbols', u => u >= 0x2D && u <= 0x38 && u !== 0x32],
  ['hg.edit', u => (u >= 0x28 && u <= 0x2C) || u === 0x39 || (u >= 0x46 && u <= 0x52) || u === 0x65],
  ['hg.numpad', u => (u >= 0x53 && u <= 0x63) || u === 0x85],
  ['hg.mods', u => u >= 0xE0 && u <= 0xE7],
  ['hg.intl', u => u === 0x32 || u === 0x64 || (u >= 0x87 && u <= 0x91)],
];

let sel = null;                  // 选中的键名
let cat = 'key';
let showMore = false;
let manual = { mods: 0, key: 0 };
let rec = null;                  // 录入中：{ down: 当前按住的修饰键, max: 按过的修饰键, msg }

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const layer = () => state.keyLayer ?? 0;
const viewMatrix = l => state.layers[l] ? applyMatrix(state.layers[l], state.keyDraft[l]) : null;
const draftCount = l => Object.keys(state.keyDraft[l]).length;
const lockReason = name => name === 'FN' ? t('lock.fn') : OFFICIAL_LOCKED.has(name) ? t('lock.f') : '';
// FN1 层里的 00 00 00 00 = 沿用默认层（2026-10-27 实机：出厂 FN1 层的 A 是空的，按 Fn+A 打出 a）
const inherits = (d, l) => d.kind === 'none' && l === 1;
const defaultOf = name => {
  const m0 = viewMatrix(0);
  return m0 ? decode(getSlot(m0, SLOT[name])) : null;
};
// 键帽上显示的名称：去掉“（LAlt+F4）”“ (LAlt+F4)”这类括号说明（#(ISO) 前面没有空格，不会被去掉）；沿用默认层的键显示默认层的功能（灰色）
const shortName = (d, l, name) => (inherits(d, l) ? defaultOf(name)?.name ?? '' : d.name).replace(/(（.*）| \(.*\))$/, '');
const fullName = (d, l, name) => inherits(d, l) ? t('ke.inherit', { name: defaultOf(name)?.name ?? '—' }) : d.name;

// ───────────── 草稿 ─────────────
function setKey(name, action) {
  const l = layer();
  if (lockReason(name) || !state.layers[l]) return;
  const d = { ...state.keyDraft[l] };
  if (same(encode(action), getSlot(state.layers[l], SLOT[name]))) delete d[name]; else d[name] = action;
  state.keyDraft[l] = d;
  render();
}
const factoryAction = name => ({ kind: 'raw', bytes: [...getSlot(FACTORY_LAYERS[layer()], SLOT[name])] });
function undoKey(name) {
  const d = { ...state.keyDraft[layer()] };
  delete d[name];
  state.keyDraft[layer()] = d;
  render();
}
function selectKey(name) {
  sel = name;
  stopRec();
  const m = viewMatrix(layer());
  const d = m ? decode(getSlot(m, SLOT[name])) : null;
  manual = d?.kind === 'key' && !d.key2 ? { mods: d.mods, key: d.key } : d?.kind === 'mods' ? { mods: d.mods, key: 0 } : { mods: 0, key: 0 };
  render();
}

// ───────────── 录入：按下要设置的键或组合键 ─────────────
function startRec() {
  if (!sel || lockReason(sel) || !state.canWrite) return;
  rec = { down: 0, max: 0, msg: '' };
  render();
}
function stopRec() {
  if (!rec) return;
  rec = null;
  render();
}
function finishRec(action) {
  rec = null;
  setKey(sel, action);
}
function onKeyDown(ev) {
  if (!rec) return;
  ev.preventDefault(); ev.stopPropagation();
  if (ev.repeat) return;
  const bit = modBit(ev.code);
  if (bit) { rec.down |= bit; rec.max |= bit; rec.msg = ''; render(); return; }
  // 录入开始前就按住的修饰键收不到 keydown，用事件上的标志补上（分不清左右，按左边算）
  const flags = (ev.ctrlKey ? 1 : 0) | (ev.shiftKey ? 2 : 0) | (ev.altKey ? 4 : 0) | (ev.metaKey ? 8 : 0);
  let mods = rec.down;
  for (const b of [1, 2, 4, 8]) if (flags & b && !(mods & (b | b << 4))) mods |= b;
  const a = recordedAction(mods, ev.code);
  if (!a) { rec.msg = t('rec.unknown', { code: ev.code || ev.key }); render(); return; }
  finishRec(a);
}
function onKeyUp(ev) {
  if (!rec) return;
  ev.preventDefault(); ev.stopPropagation();
  const bit = modBit(ev.code);
  if (!bit) return;
  rec.down &= ~bit;
  if (!rec.down && rec.max) finishRec(recordedAction(rec.max, null));
  else render();
}

// ───────────── 渲染 ─────────────
function renderKeys() {
  const l = layer();
  const m = viewMatrix(l), base = state.layers[l], factory = FACTORY_LAYERS[l];
  const draft = state.keyDraft[l];

  for (const b of $('layerTabs').children) {
    const bl = Number(b.dataset.layer);
    b.classList.toggle('on', bl === l);
    b.querySelector('i').textContent = draftCount(bl) ? draftCount(bl) : '';
  }

  // 键盘图
  const kbd = $('kbd');
  if (!kbd.childElementCount) {
    for (const [name, x, y, w] of LAYOUT) {
      const k = el('button', 'key');
      k.dataset.name = name;
      k.style.cssText = `left:${x / KB_W * 100}%;top:${y / KB_H * 100}%;width:${w / KB_W * 100}%;height:${1 / KB_H * 100}%`;
      k.innerHTML = '<span class="cap"><small></small><b></b></span>';
      k.onclick = () => selectKey(name);
      kbd.appendChild(k);
    }
  }
  for (const k of kbd.children) {
    const name = k.dataset.name, slot = SLOT[name];
    const cur = m ? getSlot(m, slot) : null;
    const d = cur ? decode(cur) : null;
    const label = d ? shortName(d, l, name) : '';
    k.querySelector('small').textContent = label === name ? '' : name;
    k.querySelector('b').textContent = label;
    k.classList.toggle('sel', sel === name);
    k.classList.toggle('locked', !!lockReason(name));
    k.classList.toggle('empty', !!d && d.kind === 'none');
    k.classList.toggle('changed', !!cur && !same(cur, getSlot(factory, slot)));
    k.classList.toggle('pending', name in draft);
    k.title = d ? t('ke.keyTitle', { key: name, fn: fullName(d, l, name) }) : name;
    k.disabled = !m || state.busy;
  }
  $('kbLoading').hidden = !!m;
  $('kbLoading').textContent = t(state.kb ? 'keys.reading' : 'keys.connect');

  const n = draftCount(0) + draftCount(1);
  $('keyDirty').textContent = n ? t('dirty.keys', { n }) : '';
  $('btnKeyApply').disabled = !n || !state.canWrite || state.busy;
  $('btnKeyDiscard').disabled = !n || state.busy;
  renderEditor(l, m, base, factory);
}

function renderEditor(l, m, base, factory) {
  const has = !!(sel && m);
  $('keEmpty').hidden = has;
  $('keBody').hidden = !has;
  if (!has) return;
  const slot = SLOT[sel];
  const cur = decode(getSlot(m, slot)), orig = decode(getSlot(base, slot)), fac = decode(getSlot(factory, slot));
  const pending = sel in state.keyDraft[l];
  $('keName').textContent = sel;
  $('keLayer').textContent = layerName(l);
  $('keNow').textContent = fullName(orig, l, sel);
  $('keFactory').textContent = fullName(fac, l, sel);
  $('kePendingRow').hidden = $('kePending').hidden = !pending;
  $('kePending').textContent = fullName(cur, l, sel);
  $('keRaw').textContent = t('ke.slot', { slot, bytes: [...getSlot(m, slot)].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join(' ') });
  $('btnKeyUndo').hidden = !pending;
  $('btnKeyUndo').disabled = state.busy;
  const atFactory = same(getSlot(m, slot), getSlot(factory, slot));
  $('btnKeyFactory').disabled = atFactory || !state.canWrite || state.busy || !!lockReason(sel);

  const lock = lockReason(sel);
  $('keLock').hidden = !lock;
  $('keLock').textContent = lock ? `🔒 ${lock}` : '';
  $('kePick').hidden = !!lock;
  if (lock) return;
  const disabled = !state.canWrite || state.busy;

  for (const b of $('catTabs').children) b.classList.toggle('on', b.dataset.cat === cat);
  $('panelKey').hidden = cat !== 'key';
  $('panelList').hidden = cat === 'key';
  const curBytes = getSlot(m, slot);

  if (cat === 'key') {
    const box = $('recBox');
    box.classList.toggle('on', !!rec);
    box.classList.toggle('off', disabled);
    if (rec) {
      const mods = MODS.filter((_, i) => rec.down & (1 << i));
      $('recMain').textContent = mods.length ? mods.join(' + ') + ' + …' : t('rec.press');
      $('recSub').textContent = rec.msg || t('rec.cancelHint');
    } else {
      $('recMain').textContent = t('rec.start');
      $('recSub').textContent = t('rec.example');
    }
    const chips = $('modChips');
    if (!chips.childElementCount) {
      MODS.forEach((name, i) => {
        const c = el('button', 'chip-btn', name);
        c.onclick = () => { manual.mods ^= 1 << i; render(); };
        chips.appendChild(c);
      });
    }
    [...chips.children].forEach((c, i) => { c.classList.toggle('on', !!(manual.mods & (1 << i))); c.disabled = disabled; });
    // 下拉框只在第一次和切换语言后重建
    const selBox = $('hidSel');
    if (selBox.dataset.lang !== getLang()) {
      selBox.dataset.lang = getLang();
      selBox.textContent = '';
      selBox.appendChild(new Option(t('man.none'), '0'));
      const codes = Object.keys(HID_NAMES).map(Number).sort((a, b) => a - b);
      for (const [title, test] of HID_GROUPS) {
        const g = document.createElement('optgroup');
        g.label = t(title);
        for (const u of codes.filter(test)) g.appendChild(new Option(HID_NAMES[u], String(u)));
        selBox.appendChild(g);
      }
      selBox.onchange = () => { manual.key = Number(selBox.value); render(); };
    }
    selBox.value = String(manual.key);
    selBox.disabled = disabled;
    const a = keyAction(manual.key, manual.mods);
    $('manualPreview').textContent = a ? decode(encode(a)).name : '—';
    $('btnManual').disabled = disabled || !a || same(encode(a), curBytes);
    return;
  }

  // 鼠标 / 多媒体 / 常用命令 / 灯光控制
  const c = CATS.find(x => x.id === cat);
  const list = $('optList');
  list.textContent = '';
  const extra = c.items.filter(i => !i.official);
  for (const item of c.items.filter(i => i.official || showMore)) {
    // FN1 层里 00 00 00 00 不是“无功能”，而是沿用默认层
    const name = l === 1 && item.action.bytes?.every(v => !v) ? t('ke.sameDefault') : L(item);
    const b = el('button', 'opt' + (item.official ? '' : ' more'), name);
    b.classList.toggle('on', same(encode(item.action), curBytes));
    b.disabled = disabled;
    b.onclick = () => setKey(sel, item.action);
    list.appendChild(b);
  }
  $('btnMore').hidden = !extra.length;
  $('btnMore').textContent = showMore ? t('more.hide') : t('more.show', { n: extra.length });
}

// ───────────── 写入 ─────────────
async function writeLayer(l, makeNext, note) {
  const res = await state.kb.writeMatrix(l, makeNext, { onBackup: cur => addBackup(cur, note, `layer${l}`) });
  state.layers[l] = res.after || res.current;
  state.keyDraft[l] = {};
  return res.written;
}

function apply() {
  const drafts = [0, 1].filter(l => draftCount(l)).map(l => [l, { ...state.keyDraft[l] }]);
  return withBusy(t('busy.writeKeys'), async () => {
    let written = false;
    for (const [l, d] of drafts) written = await writeLayer(l, cur => applyMatrix(cur, d), 'note.keys') || written;
    banner('ok', written ? 'bn.keysWritten' : 'bn.keysSame');
  });
}

function discard() {
  state.keyDraft = { 0: {}, 1: {} };
  render();
}

// 还原按键备份：只还原 87 个按键槽位
export async function restoreLayer(bk) {
  const l = bk.kind === 'layer1' ? 1 : 0;
  const when = fmtTime(bk.time);
  if (!await ask({ title: t('rs.keysTitle'), text: t('rs.keysText', { layer: layerName(l), when }), ok: t('w.restore') })) return;
  const b = fromHex(bk.hex);
  return withBusy(t('busy.restoring'), async () => {
    const written = await writeLayer(l, cur => copyMatrix(cur, b), 'note.restore');
    if (written) banner('ok', 'bn.keysRestored', { layer: layerName(l), when }); else banner('ok', 'bn.keysBackupSame');
  });
}

// 按键页第一次打开时读两层矩阵
export function ensureLayers() {
  if (!state.kb || state.page !== 'keys' || (state.layers[0] && state.layers[1])) return;
  return withBusy(t('keys.reading'), async () => {
    for (const l of [0, 1]) state.layers[l] = await state.kb.readMatrix(l);
    log('info', t('log.layersRead'));
  });
}

export function initKeysPage() {
  for (const b of $('layerTabs').children) {
    b.onclick = () => { state.keyLayer = Number(b.dataset.layer); stopRec(); selectKey(sel); };
  }
  for (const b of $('catTabs').children) b.onclick = () => { cat = b.dataset.cat; stopRec(); render(); };
  $('btnMore').onclick = () => { showMore = !showMore; render(); };
  $('recBox').onclick = ev => { ev.stopPropagation(); rec ? stopRec() : startRec(); };
  $('btnManual').onclick = () => setKey(sel, keyAction(manual.key, manual.mods));
  $('btnKeyFactory').onclick = () => setKey(sel, factoryAction(sel));
  $('btnKeyUndo').onclick = () => undoKey(sel);
  $('btnKeyApply').onclick = apply;
  $('btnKeyDiscard').onclick = discard;
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('click', () => stopRec());
  window.addEventListener('blur', () => stopRec());
  onRender(renderKeys);
}
