# 项目长期记忆 — bldc_sim (MotorForge V1)

- **定位**：Web BLDC/PMSM 电机仿真实验台。后端复用 markisus/motor_sim（一行不改）+ Adapter 层；前端 React+Vite+Three.js。
- **铁律**：前端任何显示量（Speed/Torque/Current/Angle/Id/Iq/PWM/Load）必须来自同一仿真快照，禁止客户端积分角度或自算数据（spec §九/§十四）。
- **端口**：仿真服务器固定 18098（8080 被 Windows 端口排除）。WebSocket `ws://127.0.0.1:18098/ws`。
- **目录**：`server/`（C++ Adapter + 手写 RFC6455 WS，零警告）、`web_ui/`（前端）、`tools/`（verify_e2e.py / ws_client.py）、`docs/`（UPSTREAM_ANALYSIS.md / DELIVERY.md）。
- **验证**：`python tools/verify_e2e.py --port 18098` 期望 17/17 PASS（exit 0）。前端 E2E 为浏览器人工验收。
- **运行**：`start.bat` 一键启动（构建若缺 + 仿真服务器 + Vite 5173）。
- **沙箱坑**：本机 `npm.cmd` 被 wsl.exe 黑名单拦截，npm 走 `node D:/Software/nodejs/node_modules/npm/bin/npm-cli.js`；路径用 `D:/...` 盘符式避免 Git Bash 误转。详见每日日志。
