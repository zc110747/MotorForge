#pragma once
// Minimal RFC6455 WebSocket server on WinSock2 (adapter layer, no deps).
// - one accept thread + one rx thread per client
// - text frames only; server->client frames unmasked (RFC compliant)
// - synchronous send with SO_SNDTIMEO: a dead peer never blocks the
//   simulation thread for more than 100 ms per frame
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

class WsServer {
public:
    using TextHandler = std::function<void(uint64_t client_id,
                                           const std::string& text)>;
    using CloseHandler = std::function<void(uint64_t client_id)>;

    WsServer(TextHandler on_text, CloseHandler on_close);
    ~WsServer();

    // Returns false on listen/bind failure (call WSAGetLastError-style info
    // via last_error()).
    bool start(const std::string& host, uint16_t port);
    void stop();

    void broadcast(const std::string& text);
    void send_text(uint64_t client_id, const std::string& text);

    std::string last_error() const { return last_error_; }

private:
    struct Client;
    void accept_loop();
    void rx_loop(std::shared_ptr<Client> c);
    void close_client(Client* c, const char* reason);

    TextHandler on_text_;
    CloseHandler on_close_;
    std::string last_error_;

    std::atomic<bool> running_{false};
    uint64_t listen_sock_ = ~0ull; // SOCKET stored as u64 to keep header light
    uint64_t next_client_id_ = 1;
    std::mutex clients_mtx_;
    std::vector<std::shared_ptr<Client>> clients_;
    std::vector<std::thread> threads_;
};
