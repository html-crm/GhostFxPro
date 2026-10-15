"""
GhostFxPro ML service.

A tiny HTTP wrapper around train.py: the TypeScript side posts the labeled
dataset (JSONL) and receives a model blob to load for inference. It is a
training-only service — it never touches keys, never places orders, and is not
on the live trading path.

Endpoints
  GET  /health  -> {"status":"ok"}
  POST /train   -> body = dataset JSONL, response = model JSON blob
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from train import train

MAX_BODY_BYTES = 50 * 1024 * 1024  # 50MB of decision rows is plenty.


class Handler(BaseHTTPRequestHandler):
    server_version = "ghostfx-ml/1.0"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        if self.path == "/health":
            self._send(200, {"status": "ok", "service": "ghostfx-ml"})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        if self.path != "/train":
            self._send(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(400, {"error": "empty_or_too_large"})
            return
        raw = self.rfile.read(length).decode("utf-8", "replace")
        try:
            model = train(raw)
        except ValueError as exc:
            self._send(422, {"error": str(exc)})
            return
        except Exception as exc:  # pragma: no cover - defensive
            self._send(500, {"error": f"training_failed: {exc}"})
            return
        self._send(200, model)

    def log_message(self, fmt: str, *args) -> None:  # quiet by default
        if os.environ.get("ML_VERBOSE") == "1":
            super().log_message(fmt, *args)


def main() -> None:
    port = int(os.environ.get("ML_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"[ml] listening on :{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
