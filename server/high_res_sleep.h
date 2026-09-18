#pragma once
// High-resolution sleep for Windows pacing loops.
// std::this_thread::sleep_for on this machine quantizes to ~15.6 ms and
// timeBeginPeriod(1) has no effect; the high-resolution waitable timer
// (Win10 1803+) gives ~tens-of-us resolution. Falls back to Sleep() on
// older systems.
#ifdef _WIN32
#include <windows.h>

#ifndef CREATE_WAITABLE_TIMER_HIGH_RESOLUTION
#define CREATE_WAITABLE_TIMER_HIGH_RESOLUTION 0x00000002
#endif

class HighResSleep {
public:
    HighResSleep() {
        h_ = CreateWaitableTimerExW(nullptr, nullptr,
                                    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                                    TIMER_ALL_ACCESS);
        if (!h_) h_ = CreateWaitableTimerW(nullptr, FALSE, nullptr);
    }
    ~HighResSleep() {
        if (h_) CloseHandle(h_);
    }
    void sleep_ms(double ms) {
        if (!h_) {
            Sleep((DWORD)(ms < 1.0 ? 1.0 : ms));
            return;
        }
        LARGE_INTEGER li;
        li.QuadPart = (LONGLONG)(-ms * 10000.0); // 100 ns units, relative
        SetWaitableTimer(h_, &li, 0, nullptr, nullptr, FALSE);
        WaitForSingleObject(h_, INFINITE);
    }

private:
    HANDLE h_ = nullptr;
};
#endif // _WIN32
