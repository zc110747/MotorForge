# ⚡ MotorForge — BLDC/PMSM 仿真实验台

> 基于 [markisus/motor_sim](https://github.com/markisus/motor_sim) 二次开发的 Web 端 BLDC/PMSM 电机控制仿真实验平台。
> 上游物理内核（1 MHz 电机模型 + FOC 电流环）**一行未改**，MotorForge 在其上提供 C++ Adapter、WebSocket 实时服务与 React 可视化前端。

![license](https://img.shields.io/badge/license-MIT-green)
![platform](https://img.shields.io/badge/platform-Windows-blue)
![backend](https://img.shields.io/badge/backend-C%2B%2B17%20%2B%20MSYS2%20g%2B%2B-orange)
![frontend](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite%205%20%2B%20Three.js-61dafb)

## ✨ 功能特性

- **实时物理仿真**：上游 1 MHz 定步长电机模型，FOC 10 kHz / PWM 15 kHz，实时步进（2× 倍速，可调 1–1000×）
- **速度环 PID**（Adapter 层）：Kp / Ki / Kd / 转矩限幅运行时可调，实时回读
- **3D 转子**：Three.js 定子/转子/永磁体，转子角度严格来自仿真快照（前端零积分）
- **多通道示波器**：三窗格 —— 左 SPEED·全局(锁定量程，占两行高度)；右 PWM(上) + Torque / Load / Iq / 相电流 Signals(下)，通道可点击切换
- **负载模拟**：手动恒定负载 + 周期负载（基于仿真时间，Pause 时相位自然冻结）；负载量程 = 电机在 100 rad/s 处的最大转矩（12 V ≈ 0.055 / 24 V ≈ 0.16 N·m，随电压自动切换）
- **数据记录**：CSV 导出
- **E2E 回归**：`tools/verify_e2e.py` 一键验收（21 个用例）

## 🏗️ 架构

```
markisus/motor_sim (upstream, 只读)
   │  dt=1e-6 s (1 MHz), FOC 10 kHz, PWM 15 kHz
   ▼
Adapter 层 (server/simulation_controller.cpp)
   - 速度环 PID（复用 upstream pi_control/pi_unwind + Adapter 级 D 项）
   - 周期负载严格基于 simulation.time（非 wall clock）
   │  simulation.state (JSON, 单时间戳快照, ~50 Hz)
   ▼
手写 RFC6455 WebSocket 服务器 (server/ws_server.cpp, 零依赖, WinSock2)
   │  ws://127.0.0.1:18098/ws
   ▼
前端 SimStore (web_ui/src/sim/store.ts)
   - 单例 store，每帧只 mutate，不触发 React 重渲染
   - UI 由 ~30 FPS 帧节拍驱动；3D 转子由 store.latest.rotor.angle 直接驱动
```

> **数据不可伪造约束**：前端所有显示量（Speed / Torque / Current / Angle / Id / Iq / PWM / Load）
> 全部来自同一份 `simulation.state` 快照，禁止客户端积分角度或自算数据。

## 🚀 快速开始

```bat
:: 一键启动（自动构建缺失产物 + 仿真服务器 18098 + Vite 5173）
start.bat
```

手动启动：

```bash
# 1. 构建仿真服务器（MSYS2 g++）
cd server && build.bat

# 2. 启动仿真服务器
server/build/motorforge_server.exe --port 18098

# 3. 前端 dev server
cd web_ui && npm install && npm run dev
```

打开浏览器访问 `http://localhost:5173`，点击 **Connect** 连接 `127.0.0.1:18098`。

## 🎛️ 使用说明

| 面板 | 功能 |
|---|---|
| **CTRL 仿真控制** | Start / Stop / Pause / Resume / Reset；目标转速滑块（**rad/s**，**1–100**，同步显示 rpm 换算）；母线电压 **12 V / 24 V** 两档切换 |
| **PID 速度环** | Kp / Ki / Kd / 转矩限幅在线整定；下方实时回读 Kp、Ki、Kd、PID 输出 (N·m) 与三相 PWM 占空比 |
| **SCOPE 示波器** | 三窗格：左 SPEED·全局(锁定量程，占两行)；右 PWM(上) + Torque / Load / Iq / 相电流 Signals(下) |
| **LOAD 负载** | 手动 0 ~ 最大转矩（=100 rad/s 处电机能力，12 V≈0.055 / 24 V≈0.16 N·m，随电压自动切换）；周期负载（on/off 时长可配，基于仿真时间） |
| **CSV** | 记录窗口数据导出 |

> 单位约定：WebSocket 协议与 UI 主单位统一为 **SI（rad/s）**，rpm 仅作辅助换算显示
> （1 rad/s ≈ 9.549 rpm；转速滑块范围 **1–100 rad/s ≈ 9.5–955 rpm**）。

## 🔌 WebSocket 协议（摘要）

客户端 → 服务端：

| type | 参数 | 说明 |
|---|---|---|
| `simulation.start/stop/pause/resume/reset` | — | 仿真状态机 |
| `simulation.target_speed` | `value` (rad/s, **1–100**) | 速度模式目标 |
| `simulation.target_torque` | `value` (N·m) | 转矩模式目标 |
| `simulation.control_mode` | `mode`: `speed` \| `torque` | 控制模式切换 |
| `simulation.speed_pi` | `kp`, `ki`, `kd`, `torque_limit` | 速度环 PID 在线整定 |
| `simulation.speed_scale` | `value` (1–1000) | 仿真倍速 |
| `load.configure` | `mode`, `torque`, `on_duration`, `off_duration`, `enabled` | 负载配置（torque 超限时服务端钳位到 100 rad/s 处最大转矩） |
| `motor.parameter` | `name`, `value` | 电机参数（**母线电压仅支持 12 V / 24 V 两档**，其余：相电阻/相电感/极对数/转动惯量/bEmf0） |

服务端 → 客户端：`simulation.state`（全量快照，单时间戳）、`simulation.status`、`load.state`、`simulation.error`。

## 📁 目录结构

```
MotorForge/
├── motor_sim/    # markisus/motor_sim 上游源码（只读，一行未改）
├── server/       # C++17 Adapter + 手写 RFC6455 WebSocket 服务器（-Wall -Wextra -Werror 零警告）
├── web_ui/       # React 18 + Vite 5 + Three.js 前端
├── tools/        # verify_e2e.py E2E 回归 + ws_client.py（stdlib-only）
└── docs/         # 上游分析 / 交付清单
```

## ✅ 验证

```bash
python tools/verify_e2e.py --port 18098
```

21 个用例覆盖：WebSocket 连接、目标转速闭环、负载阶跃/周期响应、负载超限钳位（E2E-19）、
母线电压 12/24V 校验（E2E-20）、暂停/恢复/复位、PWM 真实性、速度环 PID 配置回读（E2E-17）、
目标转速越界拒绝（E2E-18）等。

## 🙏 致谢 / Upstream

本项目基于 **[markisus/motor_sim](https://github.com/markisus/motor_sim)**（BIRO Motor Simulator）开发：

- `motor_sim/` 目录为上游源码的 vendored 副本，**保持只读、一行未改**
  （仅 `SimState` 初始化处对上游未初始化的 `cogging_torque_map` 做显式清零，详见 `docs/UPSTREAM_ANALYSIS.md`）
- 电机物理模型（1 MHz 电机方程、FOC 电流环、PI 控制器、SVM/PWM 调制、Clarke/Park 变换）
  全部来自上游；速度环 PID 与负载控制器为 MotorForge Adapter 层扩展
- 上游分析文档：[docs/UPSTREAM_ANALYSIS.md](docs/UPSTREAM_ANALYSIS.md)

## 📄 License

MIT © 2026 听心跳的声音 — 上游 [motor_sim](https://github.com/markisus/motor_sim) 遵循其原许可证。
