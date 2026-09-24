#!/usr/bin/env python3
"""Tiny static server for testing only (the app itself runs from file://).
- Cache-Control: no-store so edited assets are never served stale.
- POST /__shot?name=x with a PNG data URL body writes tests/shots/x.png (debug snapshots of canvases).
Usage: python3 tests/serve.py [port]"""
import http.server, os, sys, base64, re, urllib.parse
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
os.chdir(ROOT)
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/__shot':
            self.send_error(404); return
        name = re.sub(r'[^a-zA-Z0-9_-]', '', urllib.parse.parse_qs(u.query).get('name', ['shot'])[0]) or 'shot'
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        data = base64.b64decode(body.split(',', 1)[1])
        os.makedirs('tests/shots', exist_ok=True)
        with open(os.path.join('tests/shots', name + '.png'), 'wb') as f: f.write(data)
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
class S(http.server.ThreadingHTTPServer):
    request_queue_size = 128   # default 5 resets parallel script loads
    daemon_threads = True
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8743
S(('127.0.0.1', port), H).serve_forever()
