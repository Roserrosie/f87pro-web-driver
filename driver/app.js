// 入口：界面语言、连接键盘、页面切换、启动。各页面的逻辑在 page-*.js，共用工具在 ui.js。

import { WIRED_FILTER, DONGLE_FILTER, PSD_F87PRO, LED, RGB_SEGMENTS, rgbSegment, isSupported, Keyboard, hex } from './protocol.js';
import { $, state, render, onRender, log, banner, showBanner, setStatus, withBusy, effectName, applyStatic } from './ui.js';
import { t, getLang, setLang } from './i18n.js';
import { initLedPage, samePalette } from './page-led.js';
import { initKeysPage, ensureLayers } from './page-keys.js';
import { initSettingsPage } from './page-settings.js';
import { demoDevice } from './demo.js';

const PAGES = ['led', 'keys', 'settings'];

// 语言：?lang=en / zh > 上次的选择 > 浏览器语言（中文系用中文，其他用英文）
function initLang() {
  let saved = null;
  try { saved = localStorage.getItem('f87pro.lang'); } catch {}
  setLang(new URLSearchParams(location.search).get('lang') || saved || (/^zh/i.test(navigator.language) ? 'zh' : 'en'));
  applyStatic();
}
function toggleLang() {
  setLang(getLang() === 'en' ? 'zh' : 'en');
  try { localStorage.setItem('f87pro.lang', getLang()); } catch {}
  applyStatic();
  showBanner();
  render();
}

function showPage(page) {
  if (!PAGES.includes(page)) page = 'led';
  state.page = page;
  if ($('banner').classList.contains('ok')) banner('', '');
  for (const p of PAGES) $(`page-${p}`).hidden = p !== page;
  try { localStorage.setItem('f87pro.page', page); } catch {}
  if (location.hash !== `#${page}`) history.replaceState(null, '', `${location.search}#${page}`);
  render();
  ensureLayers();
}

function renderNav() {
  for (const b of $('nav').children) {
    const p = b.dataset.page;
    b.classList.toggle('on', p === state.page);
    const n = p === 'led' ? (state.draft.effect !== undefined || Object.keys(state.draft.params).length || state.palDraft ? 1 : 0)
      : p === 'keys' ? Object.keys(state.keyDraft[0]).length + Object.keys(state.keyDraft[1]).length
      : Object.keys(state.setDraft).length;
    b.classList.toggle('dirty', !!n);
  }
  setStatus(t(state.kb ? (state.demo ? 'status.demo' : 'status.wired') : state.lost ? 'status.lost' : 'status.none'), !!state.kb);
  $('btnConnect').textContent = t(state.kb ? 'btn.reconnect' : 'btn.connect');
  $('btnLang').textContent = t('lang.switch');
}

async function useDevice(dev) {
  await withBusy(t('busy.reading'), async () => {
    if (!dev.opened) await dev.open();
    state.dev = dev;
    state.kb = new Keyboard(dev, { log });
    state.lost = false;
    const psd = await state.kb.readPsd();
    state.psd = psd;
    state.canWrite = PSD_F87PRO.every((v, i) => v === psd[i]);
    log('info', t('log.psd', { psd: hex(psd) }));
    state.base = await state.kb.readLed();
    state.draft = { effect: undefined, params: {} };
    state.palDraft = null;
    state.layers = { 0: null, 1: null };
    state.keyDraft = { 0: {}, 1: {} };
    state.setDraft = {};
    try {
      state.rgb = await state.kb.readRgb();
      const first = rgbSegment(state.rgb, RGB_SEGMENTS[0]);
      if (!RGB_SEGMENTS.every(n => samePalette(rgbSegment(state.rgb, n), first))) log('info', t('log.rgbMixed'));
    } catch (err) {
      state.rgb = null;
      log('err', t('log.rgbFail', { msg: err.message }));
    }
    if (state.demo) banner('warn', 'bn.demo');
    else if (!state.canWrite) banner('bad', 'bn.readonly', { psd: hex(psd), want: hex(PSD_F87PRO) });
    else if (!isSupported(state.base[LED.EFFECT])) banner('warn', 'bn.badEffect', { name: effectName(state.base[LED.EFFECT]) });
    else banner('', '');
  });
  ensureLayers();
}

async function connect() {
  if (!('hid' in navigator)) {
    banner('bad', 'bn.noHid');
    return;
  }
  const devs = await navigator.hid.requestDevice({ filters: [WIRED_FILTER, DONGLE_FILTER] });
  if (!devs.length) return;
  const wired = devs.find(d => Keyboard.isWired(d));
  if (!wired) {
    banner('warn', 'bn.wiredOnly');
    return;
  }
  await useDevice(wired);
}

// ───────────── 启动 ─────────────
initLang();
initLedPage();
initKeysPage();
initSettingsPage();
onRender(renderNav);
$('btnConnect').onclick = () => connect().catch(err => banner('bad', err.message));
$('btnLang').onclick = toggleLang;
for (const b of $('nav').children) b.onclick = () => showPage(b.dataset.page);
// 关闭页面前提醒还没应用的修改
window.addEventListener('beforeunload', ev => {
  const dirty = [...$('nav').children].some(b => b.classList.contains('dirty'));
  if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
});

let saved = null;
try { saved = localStorage.getItem('f87pro.page'); } catch {}
showPage(location.hash.slice(1) || saved || 'led');

if (new URLSearchParams(location.search).has('demo')) {
  state.demo = true;
  useDevice(demoDevice());
} else if ('hid' in navigator) {
  navigator.hid.addEventListener('disconnect', ev => {
    if (ev.device !== state.dev) return;
    state.dev = state.kb = state.base = state.psd = null;
    state.layers = { 0: null, 1: null };
    state.canWrite = false;
    state.lost = true;
    banner('warn', 'bn.lost');
    render();
  });
  navigator.hid.getDevices().then(ds => {
    const d = ds.find(x => Keyboard.isWired(x));
    if (d) { log('info', t('log.auto', { name: d.productName })); useDevice(d); }
  });
}
