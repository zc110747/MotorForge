# Minimal stdlib-only WebSocket client (RFC6455) for backend smoke tests.
import base64
import json
import os
import socket
import struct
import time


class WsClient:
    def __init__(self, host="127.0.0.1", port=8080, path="/ws", timeout=0.2):
        self.sock = socket.create_connection((host, port), timeout=5)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("handshake failed: connection closed")
            resp += chunk
        head = resp.split(b"\r\n\r\n", 1)[0].decode()
        if "101" not in head.split("\r\n")[0]:
            raise RuntimeError("handshake failed: " + head.split("\r\n")[0])
        self.buf = resp.split(b"\r\n\r\n", 1)[1]

    def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        header = b"\x81"
        n = len(data)
        if n < 126:
            header += bytes([0x80 | n])
        elif n <= 0xFFFF:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask + masked)

    def _parse_one(self):
        """Try to parse one complete frame from self.buf.
        Returns ('text', payload) / ('pong', None) / ('closed', None),
        or None if more data is needed."""
        b = self.buf
        if len(b) < 2:
            return None
        b0, b1 = b[0], b[1]
        opcode = b0 & 0x0F
        masked = (b1 & 0x80) != 0
        ln = b1 & 0x7F
        off = 2
        if ln == 126:
            if len(b) < 4:
                return None
            ln = struct.unpack(">H", b[2:4])[0]
            off = 4
        elif ln == 127:
            if len(b) < 10:
                return None
            ln = struct.unpack(">Q", b[2:10])[0]
            off = 10
        mask_len = 4 if masked else 0
        if len(b) < off + mask_len + ln:
            return None
        payload = b[off + mask_len:off + mask_len + ln]
        if masked:
            mask = b[off:off + 4]
            payload = bytes(p ^ mask[i % 4] for i, p in enumerate(payload))
        self.buf = b[off + mask_len + ln:]
        return (opcode, payload)

    def recv(self):
        """Returns next text message (str), or None on timeout."""
        while True:
            parsed = self._parse_one()
            if parsed is None:
                # need more bytes from the socket
                try:
                    chunk = self.sock.recv(65536)
                except socket.timeout:
                    return None
                if not chunk:
                    raise RuntimeError("connection closed")
                self.buf += chunk
                continue
            opcode, payload = parsed
            if opcode == 0x8:
                raise RuntimeError("server closed connection")
            if opcode == 0x9:  # ping -> pong
                self.sock.sendall(b"\x8A" + bytes([len(payload)]) + payload)
                continue
            if opcode == 0x1:
                return payload.decode()
            # binary/pong ignored

    def drain(self, seconds):
        msgs = []
        deadline = time.time() + seconds
        while time.time() < deadline:
            m = self.recv()
            if m is not None:
                msgs.append(json.loads(m))
        return msgs

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass
