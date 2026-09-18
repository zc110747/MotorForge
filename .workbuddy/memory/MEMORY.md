# 项目长期记忆 — bldc_sim (MotorForge V1)

- **定位**：Web BLDC/PMSM 电机仿真实验台。后端复用 markisus/motor_sim（一行不改）+ Adapter 层；前端 React+Vite+Three.js。
- **铁律**：前端任何显示量（Speed/Torque/Current/Angle/Id/Iq/PWM/Load）必须来自同一仿真快照，禁止客户端积分角度或自算数据（spec §九/§十四）。
- **端口**：仿真服务器固定 18098（8080 被 Windows 端口排除）。WebSocket `ws://127.0.0.1:18098/ws`。
- **目录**：`server/`（C++ Adapter + 手写 RFC6455 WS + `win_compat.h`，零警告）、`web_ui/`（前端，含 `tests/e2e/`）、`tools/`（verify_all.py / verify_e2e.py / verify_response.py / ws_client.py）、`docs/`（UPSTREAM_ANALYSIS.md / DELIVERY.md / response_dumps / images）。
- **验证（V1.3 起）**：`python tools/verify_all.py` 一条命令自起私有服务并跑完全部回归，
  期望 **E2E 27/27 + RESPONSE 40/40 = 67/67 PASS**；前端 `cd web_ui && npm run test:e2e` 期望 **9/9**（无头 CDP+canvas 像素测量）。
  **总计 76/76**。旧命令 `verify_e2e.py --port 18098` 仍可用，但需自己先起服务。
- **运行**：`start.bat` 一键启动（构建若缺 + 依赖引导 + 仿真服务器 18098 + Vite 5173）；支持局域网访问（WS 主机由 `window.location.hostname` 推导）。
- **构建**：`server/build.bat [nopause]` **探针式选择编译器**（先用真实 TU `-fsyntax-only` 验证候选 g++），
  可用 `MOTORFORGE_GXX` 覆盖。`win_compat.h` 固定 WinAPI 基线 `_WIN32_WINNT=0x0601` 并回退 `timeapi.h`→`mmsystem.h`，
  因此 MSYS2 g++ 15.2 与精简 mingw-w64 8.1 均可零警告构建。详见每日日志。
- **沙箱坑**：本机 `npm.cmd` 被 wsl.exe 黑名单拦截，npm 走 `node D:/Software/nodejs/node_modules/npm/bin/npm-cli.js`；路径用 `D:/...` 盘符式避免 Git Bash 误转。
  **MSYS2 的 `g++.exe` 从 Bash 工具直接调用静默失败（exit 1/零输出），必须用 Python subprocess 驱动**。
- **动特性基线（整定参照）**：执行器能力 24 V@100 rad/s ≈ 0.1616 N·m、12 V ≈ 0.0549 N·m；
  0.1 N·m 阶跃在 Kp=0.05 时 dip≈1.09 rad/s（Ki=0.5）/ 1.53（Ki=0.1）/ 0.64（Ki=2.0）；
  Ki=0 永久静差 **droop = 负载/Kp**（0.05→2.00，0.02→5.00 rad/s）。
