// 设置页：休眠、防抖、导出 / 导入配置、恢复出厂、备份列表、设备信息。

import { SLEEP_OPTIONS, DEBOUNCE, PSD_F87PRO, parseLed, applyLed, hex } from './protocol.js';
import { factoryReset, FACTORY_LED } from './factory.js';
import { t } from './i18n.js';
import { buildConfig, parseConfig, diffConfig, IMPORT_COPY, sleepLabel, debounceLabel, CONFIG_TOOL } from './config.js';
import {
  $, state, render, onRender, banner, withBusy, ask, addBackup, download, fmtTime, effectName, el, log,
  backups, backupKind,
} from './ui.js';
import { restoreLed, restoreRgb } from './page-led.js';
import { restoreLayer } from './page-keys.js';

// 文件名里的时间用本地时间：2026-10-27-15-39-42
const stamp = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/[:T]/g, '-');

// ───────────── 休眠 / 防抖（灯效块里的两个字节，草稿 → 应用） ─────────────
function setSetting(key, value) {
  const cur = parseLed(state.base)[key];
  const d = { ...state.setDraft };
  if (value === cur) delete d[key]; else d[key] = value;
  state.setDraft = d;
  render();
}

function applySettings() {
  const changes = { ...state.setDraft };
  return withBusy(t('busy.writeSettings'), async () => {
    const res = await state.kb.writeLed(cur => applyLed(cur, changes), { onBackup: cur => addBackup(cur, 'note.settings') });
    state.base = res.after || res.current;
    state.setDraft = {};
    banner('ok', res.written ? 'bn.setWritten' : 'bn.ledSame');
  });
}

function seg(id, options, value, enabled, onPick) {
  const box = $(id);
  box.textContent = '';
  for (const o of options) {
    const b = el('button', value === o.v ? 'on' : '', o.label);
    b.disabled = !enabled;
    b.onclick = () => onPick(o.v);
    box.appendChild(b);
  }
}

// ───────────── 导出 / 导入 ─────────────
function exportConfig() {
  return withBusy(t('busy.readCfg'), async () => {
    const kb = state.kb;
    const data = { psd: await kb.readPsd(), led: await kb.readLed(), rgb: await kb.readRgb(), layers: {} };
    for (const l of [0, 1]) data.layers[l] = await kb.readMatrix(l);
    // 顺便刷新界面上的数据（草稿保留）
    state.base = data.led; state.rgb = data.rgb; state.layers = { ...data.layers };
    download(`f87pro-config-${stamp()}.json`, buildConfig(data));
    banner('ok', 'bn.exported');
  });
}

async function importConfig(file) {
  let cfg;
  try { cfg = parseConfig(JSON.parse(await file.text())); }
  catch (err) { banner('bad', 'bn.importBad', { file: file.name, msg: err instanceof SyntaxError ? t('cfg.notJson') : err.message }); return; }

  // 先读键盘当前内容再比较，预览里列出的就是真正会改的东西
  let diff, current;
  await withBusy(t('busy.reading'), async () => {
    current = { led: await state.kb.readLed(), rgb: await state.kb.readRgb(), layers: {} };
    for (const l of [0, 1]) current.layers[l] = await state.kb.readMatrix(l);
    state.base = current.led; state.rgb = current.rgb; state.layers = { ...current.layers };
    diff = diffConfig(current, cfg);
  });
  if (!diff) return;
  if (diff.locked.length) {
    banner('bad', 'bn.importLocked', { keys: diff.locked.join(t('sep')) });
    return;
  }
  if (!diff.parts.length) { banner('ok', 'bn.importSame'); return; }
  const ok = await ask({
    title: t('im.title'),
    text: t('im.text', { file: file.name, when: cfg.time ? t('im.when', { time: fmtTime(cfg.time) }) : '' }),
    lines: diff.parts.map(p => ({ title: p.title, lines: p.lines })),
    ok: t('im.ok'),
  });
  if (!ok) return;
  await withBusy(t('busy.importing'), async () => {
    for (const p of diff.parts) {
      const copy = cur => IMPORT_COPY[p.part](cur, cfg);
      const onBackup = cur => addBackup(cur, 'note.import', p.part);
      if (p.part === 'led') state.base = (await state.kb.writeLed(copy, { onBackup })).after ?? state.base;
      else if (p.part === 'rgb') state.rgb = (await state.kb.writeRgb(copy, { onBackup })).after ?? state.rgb;
      else {
        const l = p.part === 'layer1' ? 1 : 0;
        state.layers[l] = (await state.kb.writeMatrix(l, copy, { onBackup })).after ?? state.layers[l];
      }
      log('ok', t('log.imported', { part: p.title }));
    }
    clearDrafts();
    banner('ok', 'bn.imported', { parts: diff.parts.map(p => p.title).join(t('sep')) });
  });
}

function clearDrafts() {
  state.draft = { effect: undefined, params: {} };
  state.palDraft = null;
  state.keyDraft = { 0: {}, 1: {} };
  state.setDraft = {};
}

// ───────────── 恢复出厂 ─────────────
async function doFactoryReset() {
  const f = parseLed(FACTORY_LED);
  const ok = await ask({
    title: t('fr.title'),
    text: t('fr.text'),
    lines: [
      t('fr.l1', { name: effectName(f.effect) }), t('fr.l2'),
      t('fr.l3', { debounce: debounceLabel(f.debounce), sleep: sleepLabel(f.sleep) }), t('fr.l4'),
    ],
    ok: t('fr.ok'),
    danger: true,
  });
  if (!ok) return;
  await withBusy(t('busy.factory'), async () => {
    const res = await factoryReset(state.kb, { onBackup: (part, b) => addBackup(b, 'note.factory', part) });
    state.base = res.led.after || res.led.current;
    state.rgb = res.rgb.after || res.rgb.current;
    state.layers = { 0: res.layer0.after || res.layer0.current, 1: res.layer1.after || res.layer1.current };
    clearDrafts();
    const n = Object.values(res).filter(r => r.written).length;
    banner('ok', n ? 'bn.factoryDone' : 'bn.factorySame');
  });
}

// ───────────── 渲染 ─────────────
function renderSettings() {
  const p = state.base ? parseLed(state.base) : null;
  const sleep = state.setDraft.sleep ?? p?.sleep, debounce = state.setDraft.debounce ?? p?.debounce;
  const enabled = !!p && !state.busy;
  seg('sleepSeg', SLEEP_OPTIONS.map(o => ({ v: o.hw, label: sleepLabel(o.hw) })), sleep, enabled, v => setSetting('sleep', v));
  $('sleepVal').textContent = p ? sleepLabel(sleep) : '—';
  const levels = Array.from({ length: DEBOUNCE.MAX - DEBOUNCE.MIN + 1 }, (_, i) => DEBOUNCE.MIN + i);
  seg('debSeg', levels.map(v => ({ v, label: String(v + 1) })), debounce, enabled, v => setSetting('debounce', v));
  $('debVal').textContent = p ? debounceLabel(debounce) + (debounce === DEBOUNCE.DEFAULT ? t('set.factoryMark') : '') : '—';
  const n = Object.keys(state.setDraft).length;
  $('btnSetApply').disabled = !n || !state.canWrite || state.busy;
  $('btnSetDiscard').disabled = !n || state.busy;
  $('setDirty').textContent = n ? t('dirty.items', { n }) : '';

  const connected = !!state.kb && !state.busy;
  $('btnExport').disabled = !connected;
  $('btnImport').disabled = !connected || !state.canWrite;
  $('btnFactory').disabled = !connected || !state.canWrite;

  $('devName').textContent = !state.dev ? t('status.none') : state.demo ? t('dev.demoName') : state.dev.productName || '—';
  $('devPsd').textContent = !state.psd ? '—' : state.canWrite ? t('dev.psdOk', { psd: hex(state.psd) }) : t('dev.psdBad', { psd: hex(state.psd), want: hex(PSD_F87PRO) });
  $('devMode').textContent = state.kb ? t(state.demo ? 'dev.demo' : 'dev.wired') : '—';
  renderBackups();
}

function backupTitle(bk) {
  const k = backupKind(bk);
  return k === 'led' ? t('bkt.led', { name: effectName(bk.effect) }) : k === 'rgb' ? t('bkt.rgb') : t('bkt.keys', { layer: t(k === 'layer1' ? 'layer.1' : 'layer.0') });
}

function renderBackups() {
  const list = $('backups');
  list.textContent = '';
  if (!backups.length) list.appendChild(el('div', 'empty', t('bk.empty')));
  for (const bk of backups) {
    const k = backupKind(bk);
    const row = el('div', 'bk');
    const tag = el('span', `tag ${k.startsWith('layer') ? 'layer' : k}`, t(`bktag.${k}`));
    const info = el('div', 't');
    info.append(el('div', '', backupTitle(bk)), el('div', '', `${fmtTime(bk.time)} · ${t(bk.note)}`));
    const dl = el('button', 'btn small', t('w.download'));
    dl.onclick = () => download(`f87pro-backup-${k}-${bk.time.replace(/[:.]/g, '-')}.json`, { tool: CONFIG_TOOL, ...bk });
    const rs = el('button', 'btn small', t('w.restore'));
    rs.disabled = !state.canWrite || state.busy;
    rs.onclick = () => (k === 'rgb' ? restoreRgb(bk) : k === 'led' ? restoreLed(bk) : restoreLayer(bk));
    row.append(tag, info, dl, rs);
    list.appendChild(row);
  }
  $('btnExportAll').disabled = !backups.length;
}

export function initSettingsPage() {
  $('btnSetApply').onclick = applySettings;
  $('btnSetDiscard').onclick = () => { state.setDraft = {}; render(); };
  $('btnExport').onclick = exportConfig;
  $('btnImport').onclick = () => $('importFile').click();
  $('importFile').onchange = ev => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (f) importConfig(f);
  };
  $('btnFactory').onclick = doFactoryReset;
  $('btnExportAll').onclick = () => download(`f87pro-backups-${stamp()}.json`, { tool: CONFIG_TOOL, backups });
  onRender(renderSettings);
}
