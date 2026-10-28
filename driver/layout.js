// 键盘图共用的布局：按键页的键盘图、灯效页主视觉里的示意键盘

// 87 键 TKL 布局（单位 1u），和 probe/index.html 一样
export const LAYOUT = (() => {
  const L = [];
  const put = (names, x, y, w = 1) => { for (const n of names) { L.push([n, x, y, w]); x += w; } return x; };
  put(['Esc'], 0, 0); put(['F1', 'F2', 'F3', 'F4'], 2, 0); put(['F5', 'F6', 'F7', 'F8'], 6.5, 0); put(['F9', 'F10', 'F11', 'F12'], 11, 0);
  put(['PrtSc', 'ScrLk', 'Pause'], 15.25, 0);
  let x = put(['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='], 0, 1.25); put(['Backspace'], x, 1.25, 2);
  put(['Insert', 'Home', 'PgUp'], 15.25, 1.25);
  x = put(['Tab'], 0, 2.25, 1.5); x = put(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'], x, 2.25); put(['\\'], x, 2.25, 1.5);
  put(['Delete', 'End', 'PgDn'], 15.25, 2.25);
  x = put(['CapsLock'], 0, 3.25, 1.75); x = put(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"], x, 3.25); put(['Enter'], x, 3.25, 2.25);
  x = put(['LShift'], 0, 4.25, 2.25); x = put(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'], x, 4.25); put(['RShift'], x, 4.25, 2.75);
  put(['Up'], 16.25, 4.25);
  x = put(['LCtrl', 'LWin', 'LAlt'], 0, 5.25, 1.25); x = put(['Space'], x, 5.25, 6.25); put(['RAlt', 'FN', 'App', 'RCtrl'], x, 5.25, 1.25);
  put(['Left', 'Down', 'Right'], 15.25, 5.25);
  return L;
})();
export const KB_W = 18.25, KB_H = 6.25;
