// 各页面共用的状态和界面工具：日志、横幅、忙碌遮罩、确认弹窗、备份、界面语言。没有设备协议逻辑。

import { LED, EFFECTS, hex } from './protocol.js';
import { t, L, getLang } from './i18n.js';

export const $ = id => document.getElementById(id);
export const BACKUP_KEY = 'f87pro.ledBackups';
export const MAX_BACKUPS = 30;

export const state = {
  dev: null,
  kb: null,
  psd: null,
  base: null,                          // 最近一次从键盘读到的灯效块
  draft: { effect: undefined, params: {} },
  rgb: null,                           // 最近一次从键盘读到的颜色表
  palDraft: null,                      // 改过但还没写入的调色板 [[r,g,b] × 7]
  layers: { 0: null, 1: null },        // 最近一次读到的默认层 / FN1 层矩阵（按键页第一次打开时才读）
  keyDraft: { 0: {}, 1: {} },          // 按键草稿 { 层: { 键名: action } }
  keyLayer: 0,                         // 按键页当前显示的层
  setDraft: {},                        // 设置页草稿 { sleep?, debounce? }
  canWrite: false,
  lost: false,                         // 键盘被拔掉了（顶栏显示“已断开”）
  busy: false,
  demo: false,
  page: 'led',
};

// ───────────── 渲染：各页面注册自己的 render，任何状态变化后调 render() ─────────────
const renderers = [];
export const onRender = fn => renderers.push(fn);
export const render = () => renderers.forEach(fn => fn());

// ───────────── 界面语言：静态文字写在 HTML 的 data-i18n 上，切换语言时整体换一遍 ─────────────
const locale = () => (getLang() === 'en' ? 'en-US' : 'zh-CN');
export function applyStatic() {
  document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN';
  document.title = t('title');
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
}

// ───────────── 日志 / 提示 ─────────────
export function log(kind, msg) {
  const line = document.createElement('div');
  line.className = kind;
  line.textContent = `[${new Date().toLocaleTimeString(locale(), { hour12: false })}] ${msg}`;
  $('log').appendChild(line);
  $('log').scrollTop = $('log').scrollHeight;
}
// 横幅记住 key 和参数，切换语言后能重新翻译；key 不在文字表里时（例如报错信息）原样显示
let shown = null;
export function banner(kind, key, vars) {
  shown = key ? { kind, key, vars } : null;
  showBanner();
}
export function showBanner() {
  const b = $('banner');
  b.className = shown ? `banner show ${shown.kind}` : 'banner';
  b.textContent = shown ? t(shown.key, shown.vars) : '';
}
export function setStatus(text, on) {
  $('statusText').textContent = text;
  $('status').classList.toggle('on', on);
}

export const fmtTime = iso => new Date(iso).toLocaleString(locale(), { hour12: false });
export const fromHex = s => Uint8Array.from(s.trim().split(/\s+/).map(h => parseInt(h, 16)));
export const effectName = ui => { const e = EFFECTS.find(x => x.ui === ui); return e ? L(e) : t('fx.unknown', { ui }); };
export function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ───────────── 忙碌遮罩：所有设备操作都包在里面，出错显示横幅 ─────────────
export async function withBusy(text, fn) {
  if (state.busy) return;
  state.busy = true;
  $('overlayText').textContent = text;
  $('overlay').classList.add('show');
  render();
  try { await fn(); }
  catch (err) { banner('bad', err.message || String(err)); log('err', err.message || String(err)); console.error(err); }
  finally { state.busy = false; $('overlay').classList.remove('show'); render(); }
}

// ───────────── 确认弹窗（<dialog>）。lines：要列出的说明；check：必须先勾选的文字 ─────────────
export function ask({ title, text, lines = [], ok = t('dlg.ok'), danger = false, check }) {
  const dlg = $('dialog');
  $('dlgTitle').textContent = title;
  $('dlgText').textContent = text || '';
  const list = $('dlgList');
  list.textContent = '';
  for (const l of lines) {
    if (typeof l === 'string') list.appendChild(el('li', '', l));
    else { const li = el('li', 'grp', l.title); const ul = el('ul'); l.lines.forEach(s => ul.appendChild(el('li', '', s))); li.appendChild(ul); list.appendChild(li); }
  }
  list.hidden = !lines.length;
  const okBtn = $('dlgOk');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
  const box = $('dlgCheck');
  box.hidden = !check;
  $('dlgCheckText').textContent = check || '';
  const input = box.querySelector('input');
  input.checked = false;
  okBtn.disabled = !!check;
  input.onchange = () => { okBtn.disabled = !input.checked; };
  return new Promise(resolve => {
    dlg.onclose = () => resolve(dlg.returnValue === 'ok');
    dlg.returnValue = '';
    dlg.showModal();
  });
}

// ───────────── 备份（localStorage，读写都可能失败） ─────────────
// kind：'led' 灯效块（旧备份没有这个字段，也按灯效块处理）/ 'rgb' 颜色表 / 'layer0' 默认层 / 'layer1' FN1 层
// note 存文字表的 key（例如 'note.apply'），显示时再翻译；旧备份存的是中文原文，t() 会原样显示
export let backups = loadBackups();
function loadBackups() {
  try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch { return []; }
}
function saveBackups() {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(backups)); }
  catch { log('err', t('log.noStorage')); }
}
export const backupKind = bk => bk.kind || 'led';
export function addBackup(bytes, note, kind = 'led') {
  const entry = { kind, time: new Date().toISOString(), note, hex: hex(bytes) };
  if (kind === 'led') entry.effect = bytes[LED.EFFECT];
  backups.unshift(entry);
  backups = backups.slice(0, MAX_BACKUPS);
  saveBackups();
  log('info', t('log.backup', { kind: t(`bk.${kind}`), note: t(note) }));
}
