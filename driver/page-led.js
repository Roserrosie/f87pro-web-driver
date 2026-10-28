// 灯效页：灯效卡片、编辑面板（亮度 / 速度 / 颜色编号）、调色板。行为和真机验证过的旧版一致，只是换了布局。

import {
  EFFECTS, SUPPORTED_EFFECTS, isSupported, COLORS, MAX_LEVEL, LED,
  RGB_SEGMENTS, DEFAULT_PALETTE, rgbSegment, applyPalette, copyRgb, parseLed, applyLed,
} from './protocol.js';
import { $, state, render, onRender, banner, withBusy, ask, addBackup, fromHex, fmtTime, effectName, el } from './ui.js';
import { LAYOUT, KB_W, KB_H } from './layout.js';
import { t, L } from './i18n.js';

// ───────────── 草稿 ─────────────
const view = () => state.base ? parseLed(applyLed(state.base, state.draft)) : null;
const isDirty = () => state.draft.effect !== undefined || Object.keys(state.draft.params).length > 0;
const changeCount = () => (state.draft.effect !== undefined ? 1 : 0)
  + Object.values(state.draft.params).reduce((n, p) => n + Object.keys(p).length, 0);

function selectEffect(ui) {
  const baseEffect = state.base[LED.EFFECT];
  if (ui === baseEffect) delete state.draft.effect; else state.draft.effect = ui;
  render();
}
function setParam(ui, key, value) {
  const baseVal = parseLed(state.base).effects[ui - 1][key];
  const p = { ...(state.draft.params[ui] || {}) };
  if (value === baseVal) delete p[key]; else p[key] = value;
  if (Object.keys(p).length) state.draft.params[ui] = p; else delete state.draft.params[ui];
  render();
}
function discard() {
  state.draft = { effect: undefined, params: {} };
  render();
}

// ───────────── 调色板 ─────────────
const toCss = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const fromCss = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
export const samePalette = (a, b) => a.every((c, i) => c.every((v, j) => v === b[i][j]));
const basePalette = () => state.rgb ? rgbSegment(state.rgb, RGB_SEGMENTS[0]) : null;
const palette = () => state.palDraft || basePalette();

function setPaletteColor(i, css) {
  const pal = palette().map((c, k) => (k === i ? fromCss(css) : c.slice()));
  state.palDraft = samePalette(pal, basePalette()) ? null : pal;
  render();
}
function discardPalette() {
  state.palDraft = null;
  render();
}

// ───────────── 渲染 ─────────────
const RAINBOW = 'linear-gradient(90deg,#ff3b3b,#ffd23d,#2fd16b,#2fe0e6,#3d7bff,#d24dff)';
// 颜色 0–6 用调色板里的实际颜色（还没读到颜色表时用默认值），7 = 多彩
function swatchCss(c) {
  const pal = palette();
  return c.v === 7 ? c.css : pal ? toCss(pal[c.v]) : c.css;
}
function colorCss(e, p) {
  if (!e.color && !e.colorful) return RAINBOW;
  const c = COLORS[p.color];
  return !c || c.v === 7 ? RAINBOW : swatchCss(c);
}

function renderLed() {
  const v = view();
  const enabled = !!v && !state.busy;
  const baseEffect = state.base ? state.base[LED.EFFECT] : null;

  // 灯效卡片
  const grid = $('effects');
  grid.textContent = '';
  for (const e of SUPPORTED_EFFECTS) {
    const p = v ? v.effects[e.ui - 1] : { brightness: 0, color: 7 };
    const b = document.createElement('button');
    b.className = 'fx' + (v && v.effect === e.ui ? ' sel' : '');
    b.disabled = !enabled;
    b.innerHTML = `<div class="no">${String(e.ui).padStart(2, '0')}</div><div class="nm"></div><div class="bar"><i></i></div>`;
    b.querySelector('.nm').textContent = L(e);
    const bar = b.querySelector('.bar i');
    bar.style.width = v ? `${Math.max(p.brightness, 0) / MAX_LEVEL * 100}%` : '0';
    bar.style.background = colorCss(e, p);
    if (e.ui === baseEffect) {
      const badge = document.createElement('span');
      badge.className = 'badge'; badge.textContent = t('fx.current');
      b.appendChild(badge);
    }
    b.onclick = () => selectEffect(e.ui);
    grid.appendChild(b);
  }

  // 编辑面板
  const e = v && isSupported(v.effect) ? EFFECTS.find(x => x.ui === v.effect) : null;
  const p = e ? v.effects[e.ui - 1] : null;
  $('edName').textContent = e ? L(e) : (v ? t('ed.unsupported', { name: effectName(v.effect) }) : '—');
  $('edNo').textContent = e ? t('ed.no', { n: e.ui }) : '';
  segment('brSeg', p?.brightness, enabled && !!e, val => setParam(e.ui, 'brightness', val));
  $('brVal').textContent = p ? `${p.brightness} / ${MAX_LEVEL}` : '—';
  segment('spSeg', p?.speed, enabled && !!e?.speed, val => setParam(e.ui, 'speed', val));
  $('spVal').textContent = !e ? '—' : e.speed ? `${p.speed} / ${MAX_LEVEL}` : t('ed.noSpeed');

  const box = $('coBox');
  box.textContent = '';
  if (e && !e.color && !e.colorful) {
    box.appendChild(el('div', 'fixed', t('ed.fixedColor')));
    $('coVal').textContent = t('w.fixed');
  } else {
    const wrap = document.createElement('div'); wrap.className = 'swatches';
    for (const c of COLORS) {
      const allowed = e && (c.v === 7 ? e.colorful : e.color);
      if (e && !allowed) continue;
      const s = document.createElement('button');
      s.className = 'sw' + (p && p.color === c.v ? ' on' : '');
      s.style.background = swatchCss(c);
      s.title = `${c.v} · ${L(c)}`;
      s.disabled = !enabled || !e;
      s.onclick = () => setParam(e.ui, 'color', c.v);
      wrap.appendChild(s);
    }
    box.appendChild(wrap);
    const cur = p ? COLORS[p.color] : null;
    $('coVal').textContent = cur ? `${cur.v} · ${L(cur)}` : (p ? String(p.color) : '—');
  }

  renderHero(v, e, p);
  const dirty = isDirty();
  $('btnApply').disabled = !dirty || !state.canWrite || state.busy;
  $('btnDiscard').disabled = !dirty || state.busy;
  $('dirty').textContent = dirty ? t('dirty.items', { n: changeCount() }) : '';
  renderPalette();
}

// 主视觉：当前灯效的名称、数据块，以及按当前颜色 / 亮度发光的示意键盘
function renderHero(v, e, p) {
  const baseEffect = state.base ? state.base[LED.EFFECT] : null;
  const dirty = isDirty();
  $('heroTag').textContent = !v ? t('status.none') : dirty ? t('tag.draft') : v.effect === baseEffect ? t('fx.current') : '';
  $('heroTag').classList.toggle('draft', dirty);
  $('edDesc').textContent = e ? [t(e.speed ? 'ed.speedAdj' : 'ed.speedFixed'), t(e.color ? 'ed.colorPick' : e.colorful ? 'ed.colorful' : 'ed.colorFixed')].join(' · ') : t('ed.connectFirst');
  $('heroBr').textContent = p ? `${p.brightness} / ${MAX_LEVEL}` : '—';
  $('heroSp').textContent = !p ? '—' : e.speed ? `${p.speed} / ${MAX_LEVEL}` : t('w.fixed');
  const c = p && COLORS[p.color];
  $('heroCo').textContent = !p ? '—' : (!e.color && !e.colorful) ? t('w.fixed') : c ? c.v === 7 ? L(c) : t('hero.colorN', { n: c.v }) : String(p.color);

  // 示意键盘只建一次，之后只改颜色
  const kb = $('heroKb');
  if (!kb.childElementCount) {
    for (const [, x, y, w] of LAYOUT) {
      const k = el('i');
      k.style.cssText = `left:${x / KB_W * 100}%;top:${y / KB_H * 100}%;width:${w / KB_W * 100}%;height:${1 / KB_H * 100}%`;
      k.dataset.x = x + w / 2;
      kb.appendChild(k);
    }
  }
  const rainbow = !p || !e || (!e.color && !e.colorful) || p.color === 7;
  const solid = rainbow ? null : swatchCss(COLORS[p.color] || COLORS[0]);
  kb.style.setProperty('--lvl', p ? p.brightness / MAX_LEVEL : 0.35);
  for (const k of kb.children) {
    k.style.setProperty('--glow', solid || `hsl(${Math.round(k.dataset.x / KB_W * 300)} 95% 58%)`);
  }

  // 底栏：调色板 7 色
  const dots = $('heroDots');
  if (!dots.childElementCount) for (let i = 0; i < 7; i++) dots.appendChild(el('i'));
  const pal = palette();
  [...dots.children].forEach((d, i) => { d.style.background = toCss(pal ? pal[i] : DEFAULT_PALETTE[i]); });
}

// 取色器只创建一次：重新渲染时如果重建 <input type=color>，正在打开的取色窗口会被关掉
function renderPalette() {
  const box = $('palette');
  if (!box.childElementCount) {
    COLORS.filter(c => c.v < 7).forEach(c => {
      const cell = document.createElement('label');
      cell.className = 'pc';
      cell.innerHTML = '<input type="color"><span></span>';
      cell.lastChild.textContent = c.v;
      cell.firstChild.oninput = ev => setPaletteColor(c.v, ev.target.value);
      box.appendChild(cell);
    });
  }
  const pal = palette(), base = basePalette();
  [...box.children].forEach((cell, i) => {
    const input = cell.firstChild;
    const css = toCss(pal ? pal[i] : DEFAULT_PALETTE[i]);
    if (input.value !== css) input.value = css;
    input.disabled = !state.rgb || state.busy;
    input.title = t('pal.cell', { i, css: css.toUpperCase() });
    cell.classList.toggle('chg', !!(pal && base) && !pal[i].every((v, j) => v === base[i][j]));
  });
  const n = state.palDraft ? state.palDraft.filter((c, i) => !c.every((v, j) => v === base[i][j])).length : 0;
  $('btnPalApply').disabled = !state.palDraft || !state.canWrite || state.busy;
  $('btnPalDiscard').disabled = !state.palDraft || state.busy;
  $('btnPalFactory').disabled = !state.rgb || !state.canWrite || state.busy || (!state.palDraft && samePalette(base, DEFAULT_PALETTE));
  $('palDirty').textContent = n ? t('pal.dirty', { n }) : (state.base && !state.rgb ? t('pal.noRead') : '');
}

function segment(id, value, enabled, onPick) {
  const seg = $(id);
  seg.textContent = '';
  for (let i = 0; i <= MAX_LEVEL; i++) {
    const b = document.createElement('button');
    b.textContent = i;
    b.className = value === i ? 'on' : '';
    b.disabled = !enabled;
    b.onclick = () => onPick(i);
    seg.appendChild(b);
  }
}

// ───────────── 写入 ─────────────
// note：备份说明的文字 key；done：成功横幅 [key, 参数]
async function writeChanges(changes, note, done) {
  const res = await state.kb.writeLed(cur => applyLed(cur, changes), { onBackup: cur => addBackup(cur, note) });
  state.base = res.after || res.current;
  state.draft = { effect: undefined, params: {} };
  if (res.written) banner('ok', ...done); else banner('ok', 'bn.ledSame');
}

function apply() {
  const changes = structuredClone(state.draft);
  return withBusy(t('busy.writeKb'), () => writeChanges(changes, 'note.apply', ['bn.written']));
}

// 还原灯效备份：当前灯效 + 各灯效参数（防抖、休眠不跟着还原）
export async function restoreLed(bk) {
  const p = parseLed(fromHex(bk.hex));
  const when = fmtTime(bk.time);
  if (!await ask({ title: t('rs.ledTitle'), text: t('rs.ledText', { when, name: effectName(bk.effect) }), ok: t('w.restore') })) return;
  const changes = { params: {} };
  if (isSupported(p.effect)) changes.effect = p.effect;
  for (const e of p.effects) changes.params[e.ui] = { brightness: e.brightness, speed: e.speed, color: e.color };
  return withBusy(t('busy.restoring'), () => writeChanges(changes, 'note.restore', ['bn.restored', { when }]));
}

async function writeRgb(makeNext, note, done) {
  const res = await state.kb.writeRgb(makeNext, { onBackup: cur => addBackup(cur, note, 'rgb') });
  state.rgb = res.after || res.current;
  state.palDraft = null;
  if (res.written) banner('ok', ...done); else banner('ok', 'bn.rgbSame');
}

function applyPaletteDraft() {
  const pal = state.palDraft.map(c => c.slice());
  return withBusy(t('busy.writeColors'), () => writeRgb(cur => applyPalette(cur, pal), 'note.palette', ['bn.rgbWritten']));
}

async function factoryPalette() {
  if (!await ask({ title: t('pal.factory'), text: t('pf.text'), ok: t('w.reset') })) return;
  return withBusy(t('busy.factoryColors'), () => writeRgb(cur => applyPalette(cur, DEFAULT_PALETTE), 'note.factoryColors', ['bn.factoryColors']));
}

// 只还原调色板用到的段，其他字节保持键盘当前内容
export async function restoreRgb(bk) {
  const b = fromHex(bk.hex);
  const when = fmtTime(bk.time);
  if (!await ask({ title: t('rs.rgbTitle'), text: t('rs.rgbText', { when }), ok: t('w.restore') })) return;
  return withBusy(t('busy.restoring'), () => writeRgb(cur => copyRgb(cur, b), 'note.restore', ['bn.rgbRestored', { when }]));
}

export function initLedPage() {
  $('btnApply').onclick = apply;
  $('btnDiscard').onclick = discard;
  $('btnPalApply').onclick = applyPaletteDraft;
  $('btnPalDiscard').onclick = discardPalette;
  $('btnPalFactory').onclick = factoryPalette;
  onRender(renderLed);
}
