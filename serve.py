# 网页驱动用的本地服务器（WebHID 只能在 localhost 或 https 下用，不能直接双击 html 打开）。
# 和 python -m http.server 一样，另外：不让浏览器缓存（改完代码不用 Ctrl+F5）、启动后自动用 Chrome 打开驱动页。
# 用法：双击「启动驱动.bat」，或 python serve.py [--port 8787] [--no-browser]

import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
PORT = int(args[args.index('--port') + 1]) if '--port' in args else 8787
URL = f'http://localhost:{PORT}/driver/'


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *a):
        pass


def in_use():
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', PORT)) == 0


# WebHID 只有 Chrome / Edge 支持：先找 Chrome，找不到就用系统默认浏览器（Windows 默认的 Edge 也可以）
def open_browser():
    if '--no-browser' in args:
        return
    for base in (os.environ.get('ProgramFiles'), os.environ.get('ProgramFiles(x86)'), os.environ.get('LOCALAPPDATA')):
        chrome = base and os.path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')
        if chrome and os.path.exists(chrome):
            webbrowser.register('chrome', None, webbrowser.BackgroundBrowser(chrome))
            webbrowser.get('chrome').open(URL)
            return
    webbrowser.open(URL)


if in_use():
    print(f'驱动已经在运行了，直接打开 {URL}')
    open_browser()
    sys.exit(0)

server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT))
print('AULA F87 PRO 网页驱动已启动')
print(f'地址：{URL}')
print('用完直接关掉这个窗口即可。')
threading.Timer(0.3, open_browser).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
