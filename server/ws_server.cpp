#include "ws_server.h"

#include <winsock2.h>
#include <ws2tcpip.h>

#include "high_res_sleep.h"

#include <chrono>
#include <cstring>
#include <sstream>

namespace {

constexpr const char* kWsGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
constexpr size_t kMaxRxFrame = 1 << 20;   // 1 MiB rx cap

// ---------------- SHA1 (public domain style implementation) ----------------
struct Sha1 {
    uint32_t h[5] = {0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476,
                     0xC3D2E1F0};
    uint64_t len = 0;
    uint8_t buf[64] = {};
    size_t buf_len = 0;

    static uint32_t rol(uint32_t v, int b) { return (v << b) | (v >> (32 - b)); }

    void block(const uint8_t* p) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = (uint32_t)p[i * 4] << 24 | (uint32_t)p[i * 4 + 1] << 16 |
                   (uint32_t)p[i * 4 + 2] << 8 | (uint32_t)p[i * 4 + 3];
        for (int i = 16; i < 80; ++i)
            w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }
            uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }

    void update(const uint8_t* p, size_t n) {
        len += n;
        while (n > 0) {
            size_t take = 64 - buf_len < n ? 64 - buf_len : n;
            memcpy(buf + buf_len, p, take);
            buf_len += take;
            p += take;
            n -= take;
            if (buf_len == 64) { block(buf); buf_len = 0; }
        }
    }

    std::string final() {
        uint64_t bits = len * 8;
        uint8_t pad = 0x80;
        update(&pad, 1);
        uint8_t z = 0;
        while (buf_len != 56) update(&z, 1);
        uint8_t lenb[8];
        for (int i = 0; i < 8; ++i) lenb[i] = (uint8_t)(bits >> (56 - i * 8));
        update(lenb, 8);
        std::string out(20, '\0');
        for (int i = 0; i < 5; ++i)
            for (int j = 0; j < 4; ++j)
                out[i * 4 + j] = (char)(h[i] >> (24 - j * 8));
        return out;
    }
};

std::string sha1_base64(const std::string& input) {
    Sha1 sha;
    sha.update((const uint8_t*)input.data(), input.size());
    std::string digest = sha.final();
    static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    for (size_t i = 0; i < digest.size(); i += 3) {
        uint32_t v = (uint8_t)digest[i] << 16;
        if (i + 1 < digest.size()) v |= (uint8_t)digest[i + 1] << 8;
        if (i + 2 < digest.size()) v |= (uint8_t)digest[i + 2];
        out += tbl[(v >> 18) & 63];
        out += tbl[(v >> 12) & 63];
        out += i + 1 < digest.size() ? tbl[(v >> 6) & 63] : '=';
        out += i + 2 < digest.size() ? tbl[v & 63] : '=';
    }
    return out;
}

std::string to_lower(std::string s) {
    for (char& c : s) c = (char)tolower((unsigned char)c);
    return s;
}

bool send_all(SOCKET s, const char* p, size_t n) {
    while (n > 0) {
        int w = ::send(s, p, (int)n, 0);
        if (w == SOCKET_ERROR) return false;
        p += w;
        n -= (size_t)w;
    }
    return true;
}

bool recv_some(SOCKET s, std::string* buf) {
    char tmp[8192];
    int r = ::recv(s, tmp, sizeof(tmp), 0);
    if (r <= 0) return false;
    buf->append(tmp, (size_t)r);
    return true;
}

} // namespace

// ---------------------------------------------------------------------------

struct WsServer::Client {
    uint64_t id = 0;
    SOCKET sock = INVALID_SOCKET;
    std::mutex send_mtx;
    std::atomic<bool> closed{false};
};

WsServer::WsServer(TextHandler on_text, CloseHandler on_close)
    : on_text_(std::move(on_text)), on_close_(std::move(on_close)) {}

WsServer::~WsServer() { stop(); }

bool WsServer::start(const std::string& host, uint16_t port) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        last_error_ = "WSAStartup failed";
        return false;
    }
    SOCKET l = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (l == INVALID_SOCKET) {
        last_error_ = "socket() failed";
        return false;
    }
    BOOL reuse = TRUE;
    ::setsockopt(l, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    if (inet_pton(AF_INET, host.c_str(), &addr.sin_addr) != 1)
        addr.sin_addr.s_addr = INADDR_ANY;
    if (::bind(l, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        last_error_ = "bind failed on " + host + ":" + std::to_string(port) +
                      " (winsock error " + std::to_string(WSAGetLastError()) + ")";
        closesocket(l);
        return false;
    }
    if (::listen(l, 4) == SOCKET_ERROR) {
        last_error_ = "listen failed";
        closesocket(l);
        return false;
    }
    listen_sock_ = (uint64_t)l;
    running_ = true;
    threads_.emplace_back([this] { accept_loop(); });
    return true;
}

void WsServer::stop() {
    if (!running_.exchange(false)) return;
    if (listen_sock_ != ~0ull) {
        ::closesocket((SOCKET)listen_sock_);
        listen_sock_ = ~0ull;
    }
    std::vector<std::shared_ptr<Client>> clients;
    {
        std::lock_guard<std::mutex> lk(clients_mtx_);
        clients = clients_;
        clients_.clear();
    }
    for (auto& c : clients) {
        c->closed = true;
        ::closesocket(c->sock);
    }
    for (auto& t : threads_) {
        if (t.joinable()) t.join();
    }
    threads_.clear();
    WSACleanup();
}

void WsServer::accept_loop() {
    SOCKET l = (SOCKET)listen_sock_;
    while (running_.load()) {
        sockaddr_in peer{};
        int peer_len = sizeof(peer);
        SOCKET s = ::accept(l, (sockaddr*)&peer, &peer_len);
        if (s == INVALID_SOCKET) {
            if (!running_.load()) break;
            continue;
        }

        // --- HTTP upgrade handshake ---
        std::string buf;
        buf.reserve(2048);
        size_t hdr_end = std::string::npos;
        while (buf.size() < 65536) {
            hdr_end = buf.find("\r\n\r\n");
            if (hdr_end != std::string::npos) break;
            if (!recv_some(s, &buf)) break;
        }
        bool ok = hdr_end != std::string::npos;
        std::string ws_key;
        if (ok) {
            std::istringstream iss(buf.substr(0, hdr_end));
            std::string line;
            while (std::getline(iss, line)) {
                if (!line.empty() && line.back() == '\r') line.pop_back();
                const size_t colon = line.find(':');
                if (colon == std::string::npos) continue;
                std::string k = to_lower(line.substr(0, colon));
                std::string v = line.substr(colon + 1);
                while (!v.empty() && (v.front() == ' ' || v.front() == '\t')) v.erase(v.begin());
                if (k == "sec-websocket-key") ws_key = v;
                if (k == "upgrade" && to_lower(v) != "websocket") ok = false;
            }
        }
        ok = ok && !ws_key.empty();
        if (ok) {
            std::string accept = sha1_base64(ws_key + kWsGuid);
            std::string resp =
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
            ok = send_all(s, resp.data(), resp.size());
        }
        if (!ok) {
            closesocket(s);
            continue;
        }

        auto c = std::make_shared<Client>();
        c->id = next_client_id_++;
        c->sock = s;
        // 50 Hz small frames: disable Nagle to avoid delayed-ACK stall
        BOOL nodelay = TRUE;
        ::setsockopt(s, IPPROTO_TCP, TCP_NODELAY, (const char*)&nodelay,
                     sizeof(nodelay));
        DWORD snd_to = 100; // ms; never block the sim thread on a dead peer
        ::setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&snd_to,
                     sizeof(snd_to));
        {
            std::lock_guard<std::mutex> lk(clients_mtx_);
            clients_.push_back(c);
        }
        threads_.emplace_back([this, c] { rx_loop(c); });
    }
}

void WsServer::rx_loop(std::shared_ptr<Client> c) {
    std::string buf;
    while (running_.load() && !c->closed.load()) {
        // ensure we have at least a frame header
        if (buf.size() < 2) {
            if (!recv_some(c->sock, &buf)) break;
            continue;
        }
        const uint8_t b0 = (uint8_t)buf[0];
        const uint8_t b1 = (uint8_t)buf[1];
        const bool masked = (b1 & 0x80) != 0;
        uint64_t len = b1 & 0x7F;
        size_t offset = 2;
        if (len == 126) {
            if (buf.size() < 4) { if (!recv_some(c->sock, &buf)) break; continue; }
            len = ((uint64_t)(uint8_t)buf[2] << 8) | (uint8_t)buf[3];
            offset = 4;
        } else if (len == 127) {
            if (buf.size() < 10) { if (!recv_some(c->sock, &buf)) break; continue; }
            len = 0;
            for (int i = 0; i < 8; ++i)
                len = (len << 8) | (uint8_t)buf[2 + i];
            offset = 10;
        }
        const size_t mask_len = masked ? 4 : 0;
        if (len > kMaxRxFrame) break;
        if (buf.size() < offset + mask_len + len) {
            if (!recv_some(c->sock, &buf)) break;
            continue;
        }

        uint8_t mask[4] = {};
        if (masked) memcpy(mask, buf.data() + offset, 4);
        std::string payload(buf.data() + offset + mask_len, (size_t)len);
        if (masked)
            for (size_t i = 0; i < payload.size(); ++i)
                payload[i] ^= mask[i % 4];
        buf.erase(0, offset + mask_len + (size_t)len);

        const int opcode = b0 & 0x0F;
        if (opcode == 0x8) { // close
            break;
        } else if (opcode == 0x9) { // ping -> pong
            std::string pong;
            pong += (char)0x8A;
            pong += (char)(payload.size() & 0x7F);
            pong += payload;
            std::lock_guard<std::mutex> lk(c->send_mtx);
            send_all(c->sock, pong.data(), pong.size());
        } else if (opcode == 0x1) { // text
            if (on_text_) on_text_(c->id, payload);
        }
        // opcodes 0x2 (binary), 0xA (pong) ignored; fragmentation unsupported
    }
    close_client(c.get(), "rx ended");
    if (on_close_) on_close_(c->id);
}

void WsServer::close_client(Client* c, const char*) {
    bool expected = false;
    if (c->closed.compare_exchange_strong(expected, true)) {
        ::closesocket(c->sock);
    }
}

void WsServer::send_text(uint64_t client_id, const std::string& text) {
    std::shared_ptr<Client> target;
    {
        std::lock_guard<std::mutex> lk(clients_mtx_);
        for (auto& c : clients_)
            if (c->id == client_id && !c->closed.load()) target = c;
    }
    if (!target) return;
    std::string frame;
    frame += (char)0x81; // FIN + text
    const size_t n = text.size();
    if (n < 126) {
        frame += (char)n;
    } else if (n <= 0xFFFF) {
        frame += (char)126;
        frame += (char)((n >> 8) & 0xFF);
        frame += (char)(n & 0xFF);
    } else {
        frame += (char)127;
        uint64_t m = n;
        for (int i = 7; i >= 0; --i) frame += (char)((m >> (i * 8)) & 0xFF);
    }
    frame += text;
    std::lock_guard<std::mutex> lk(target->send_mtx);
    if (!send_all(target->sock, frame.data(), frame.size())) {
        close_client(target.get(), "send failed");
    }
}

void WsServer::broadcast(const std::string& text) {
    std::vector<std::shared_ptr<Client>> clients;
    {
        std::lock_guard<std::mutex> lk(clients_mtx_);
        for (auto& c : clients_)
            if (!c->closed.load()) clients.push_back(c);
    }
    std::string frame;
    frame.reserve(text.size() + 10);
    frame += (char)0x81; // FIN + text
    if (text.size() < 126) {
        frame += (char)text.size();
    } else if (text.size() <= 0xFFFF) {
        frame += (char)126;
        frame += (char)((text.size() >> 8) & 0xFF);
        frame += (char)(text.size() & 0xFF);
    } else {
        frame += (char)127;
        uint64_t n = text.size();
        for (int i = 7; i >= 0; --i) frame += (char)((n >> (i * 8)) & 0xFF);
    }
    frame += text;

    for (auto& c : clients) {
        std::lock_guard<std::mutex> lk(c->send_mtx);
        if (!send_all(c->sock, frame.data(), frame.size())) {
            close_client(c.get(), "send failed");
        }
    }
}
