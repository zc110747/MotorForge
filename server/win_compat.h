#pragma once
// Windows API baseline for the MotorForge adapter/server layer.
//
// WHY THIS FILE EXISTS
// --------------------
// build.bat used to pick g++ with `where g++`, i.e. "whatever is first in
// PATH". On a machine that also ships a stripped mingw-w64 (the embedded one
// that comes with graphics/SDK bundles) that compiler wins, and the build
// dies with three unrelated-looking errors:
//
//   main.cpp:17:10      fatal error: timeapi.h: No such file or directory
//   high_res_sleep.h:17 error: 'CreateWaitableTimerExW' was not declared
//   ws_server.cpp:149   error: 'inet_pton' was not declared
//
// They share one root cause: the toolchain advertised a very old Windows
// version. Below _WIN32_WINNT 0x0600 the Windows headers deliberately hide
// every Vista+ API, and stripped distributions ship only mmsystem.h (not
// timeapi.h) because nothing in their own product needs the split-out header.
//
// The portability contract of this project is therefore declared HERE rather
// than relying on compiler defaults:
//
//   1. Raise the API baseline to Windows 7 (_WIN32_WINNT = 0x0601). That makes
//      CreateWaitableTimerExW and inet_pton visible on every mingw-w64 >= 8.
//      (The project needs 0x0601 anyway.)
//   2. timeBeginPeriod/timeEndPeriod are declared by BOTH timeapi.h and
//      mmsystem.h, so fall back to mmsystem.h when timeapi.h is absent
//      instead of failing the build.
//
// Include this file BEFORE any <windows.h> / <winsock2.h> usage. It pulls in
// <windows.h> itself, so callers do not need to.
#ifdef _WIN32

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601 /* Windows 7 baseline */
#endif
#ifndef WINVER
#define WINVER _WIN32_WINNT
#endif
#ifndef _WIN32_WINDOWS
#define _WIN32_WINDOWS 0x0601
#endif

#include <windows.h>

/* timeBeginPeriod/timeEndPeriod (multi-media timer resolution). */
#if defined(__has_include)
#if __has_include(<timeapi.h>)
#include <timeapi.h>
#elif __has_include(<mmsystem.h>)
#include <mmsystem.h>
#endif
#else
#include <mmsystem.h>
#endif

#endif // _WIN32
