// 演示用模拟键盘（?demo=1）：用实机读到的数据初始化，支持 0x82 / 0x84·0x04 / 0x8A·0x0A / 0x83·0x03。不碰真实设备。

import { PSD_F87PRO, RGB, DEFAULT_PALETTE } from './protocol.js';
import { FACTORY_LED, FACTORY_LAYERS } from './factory.js';

export function demoDevice() {
  let led = Uint8Array.from(FACTORY_LED);
  // 颜色表和实机读到的一样：第 1–13 段是出厂调色板，0x1FA 签名
  let rgb = new Uint8Array(RGB.SIZE);
  for (let n = 1; n <= 13; n++) DEFAULT_PALETTE.forEach((c, i) => rgb.set(c, n * RGB.SEG + i * 3));
  rgb[RGB.SIG] = 0x5A; rgb[RGB.SIG + 1] = 0xA5;
  // 第 2、3 层网页版不用，拿默认层充数
  const layers = [FACTORY_LAYERS[0], FACTORY_LAYERS[1], FACTORY_LAYERS[0], FACTORY_LAYERS[0]].map(l => Uint8Array.from(l));
  let pending = 0, sub = 0;
  return {
    opened: true, productName: '模拟 F87 PRO',
    collections: [{ usagePage: 0xFF00, usage: 1, featureReports: [{ reportId: 6 }] }],
    async open() {},
    async sendFeatureReport(id, data) {
      if (data[0] === 0x04) led = Uint8Array.from(data.subarray(7, 7 + 128));
      else if (data[0] === 0x0A) rgb = Uint8Array.from(data.subarray(7, 7 + RGB.SIZE));
      else if (data[0] === 0x03) layers[data[1]] = Uint8Array.from(data.subarray(7, 7 + 512));
      else { pending = data[0]; sub = data[1]; }
    },
    async receiveFeatureReport() {
      const body = pending === 0x82 ? PSD_F87PRO : pending === 0x8A ? rgb : pending === 0x83 ? layers[sub] : led;
      const r = new Uint8Array(8 + Math.max(body.length, 128));
      r.set([0x06, pending, 0, 0, 1, 0, body.length & 0xFF, body.length >> 8]);
      r.set(body, 8);
      return new DataView(r.buffer);
    },
  };
}
