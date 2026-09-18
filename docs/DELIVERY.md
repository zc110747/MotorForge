# MotorForge V1 — 交付清单

> Web BLDC/PMSM 电机控制仿真实验平台
> 后端：markisus/motor_sim（**一行未改**）+ Adapter 层；前端：React + Vite + Three.js
> 生成日期：2026-09-18

## 一、架构与"数据不可伪造"约束落实

```
markisus/motor_sim (upstream, 只读)
   │  dt=1e-6 (1 MHz), FOC 10 kHz, PWM 15 kHz
   ▼
Adapter 层 (server/simulation_controller.cpp)
   - 复用 upstream pi_control / clarke_transform / park 实现速度环
   - 周期负载严格基于 simulation.time (非 wall clock)
   │  simulation.state (json, 单时间戳快照)
   ▼
手写 RFC6455 WebSocket 服务器 (server/ws_server.cpp, 无依赖, WinSock2)
   │  ws://127.0.0.1:18098/ws  (~47 Hz)
   ▼
前端 SimStore (web_ui/src/sim/store.ts)
   - 单例 store + Ring Buffer，每帧只 mutate，不触发 React 重渲染
   - UI 由 ~30 FPS 帧节拍驱动；3D 转子由 store.latest.rotor.angle 直接驱动
   - 所有显示量 (Speed/Torque/Current/Angle/Id/Iq/PWM/Load) 来自同一快照
```

关键纪律（spec §九/§十四）：前端**从不**自己积分角度、`Speed → 后端 / Torque → 前端` 这种拆分被禁止。

## 二、已实现 Phase

| Phase | 内容 | 状态 |
|---|---|---|
| 1 | 上游分析 `docs/UPSTREAM_ANALYSIS.md` | ✅ |
| 2-3 | C++ Adapter + WebSocket 后端（速度环/负载/快照序列化） | ✅ |
| 4 | React+Vite 最小 UI（Connection/Status/Speed/RotorAngle） | ✅ |
| 5 | Three.js 电机（定子/转子/永磁体），转子严格按 `rotor.angle` | ✅ |
| 6 | Control Dashboard（Target/Actual/Error/Torque/Current/Id/Iq/PWM） | ✅ |
| 7 | 手动负载（0~2 N·m，实测转速 dip 真实） | ✅ |
| 8 | 周期负载（基于仿真时间，相位/剩余时间可跟踪） | ✅ |
| 9 | Canvas 示波器（Speed/Torque/Load/Iq/Ia/Ib/Ic/PWM，通道可切换） | ✅ |
| 10 | 数据记录 + CSV 导出 | ✅ |
| 11-12 | start.bat 一键启动 + E2E 回归 | ✅ |

## 三、E2E 通过矩阵（`tools/verify_e2e.py`，17/17 PASS）

| 用例 | 验收点 | 结果 |
|---|---|---|
| E2E-01 | WebSocket 连接 | ✅ |
| E2E-02 | simulation.status = running | ✅ |
| E2E-03 | 目标转速闭环（±30 rpm） | ✅ 980.1 rpm @1000 |
| E2E-04 | 转子角度随仿真更新 | ✅ |
| E2E-05 | 手动负载 0→0.1 N·m 实测生效 | ✅ |
| E2E-06 | 加载后转速真实下探 | ✅ min 998.9 |
| E2E-07 | 周期负载 ≥2 周期 | ✅ on/off 各 ~140 帧 |
| E2E-08 | 周期相位剩余时间跟踪 | ✅ ≤1.0s |
| E2E-09 | 负载在 0 / 0.1 N·m 间切换 | ✅ [0, 0.1] |
| E2E-09b | ON 相转速低于 OFF 相 | ✅ 999.8 < 1000.2 |
| E2E-10 | pause 冻结仿真时间（含相位） | ✅ t 不变 |
| E2E-11 | resume 继续运行 | ✅ |
| E2E-12 | reset 复位到初始态 | ✅ t=0, status=stopped |
| E2E-13 | 单时间戳快照字段一致 | ✅ |
| E2E-14 | PWM 占空比来自真实 SVM | ✅ 0~1 非恒定 |
| E2E-15 | Dashboard 数据活跃更新 | ✅ |
| E2E-16 | 断线处理干净 | ✅ |

## 三b、V1.1 迭代（2026-09-18 下午）

| # | 需求 | 落地 | 状态 |
|---|---|---|---|
| 1 | 连接框太窄；Connect 不切换 Disconnect | host 输入 130px / port 76px；连接后按钮变 **Disconnect**（红色描边），点击主动断开并抑制自动重连（`store.disconnect()`） | ✅ |
| 2 | 设 1420 rpm 实测显示 148.7 | **根因：单位双重换算**——前端把 rpm 除以 9.549 发 rad/s，后端 `cmd_target_speed` 又按 rpm 乘回，1420 rpm 只剩 148.7 rpm。修复：WS 协议 `simulation.target_speed` 统一为 **rad/s（SI，范围 [0, 400]）**，UI 滑块/数值/实测全部 rad/s 主单位 + rpm 辅助换算，一一对应 | ✅ |
| 3 | 示波器分离 | 上排左右两个半宽窗格（左 **PWM**、右 **Speed**），其余 Torque/Load/Iq/Ia/Ib/Ic 放下排独立示波器；抽公用组件 `Scope.tsx` | ✅ |
| 4 | PID 可配置 + 实时显示 | Adapter 速度环新增 **Kd 项**（误差微分 + 5 ms 一阶低频滤波，kd=0 等价原 PI）；`simulation.speed_pi` 增加 `kd`；快照新增 `speedKp/speedKi/speedKd`；新增 **PID 面板**（CTRL 下方）：Kp/Ki/Kd/限幅在线整定 + 下方实时回读 Kp/Ki/Kd、PID 输出 (N·m)、三相 PWM 占空比 | ✅ |
| 5 | GitHub 风格 README | 新建 `README.md`（徽章/架构图/协议表/上游致谢），注明基于 markisus/motor_sim 二次开发、上游一行未改 | ✅ |

E2E 扩展至 **19 项**（E2E-17 PID 配置回读、E2E-18 目标转速 >400 rad/s 拒绝）。
本轮构建：C++ 零警告、tsc 0 错误、vite build 成功。注意：本轮完整 E2E 首跑 17/19
（E2E-03/06 失败，事后定位为**残留旧版本服务器进程干扰**——新二进制下独立探针复测
1000 rpm 闭环与负载下探均正常收敛），请在干净环境（仅一个服务器实例）重跑确认 19/19。

## 四、构建数字（零警告）

- **C++ 后端**：`g++ -std=c++17 -Wall -Wextra -Werror`（Adapter 层），upstream 仅 `-w`/`-isystem` 屏蔽；产物 `server/build/motorforge_server.exe`。
- **前端**：`tsc`（strict + noUnusedLocals + noUnusedParameters）0 错误；`vite build` 成功。JS 包 626 KB（gzip 169 KB，仅 chunk 体积提示，非编译错误）。
- 运行期：`sleep_for` 实测 15.6 ms 已被 `HighResSleep`（CREATE_WAITABLE_TIMER_HIGH_RESOLUTION）替代；WS 广播同步直写 + `TCP_NODELAY` + `SO_SNDTIMEO=100ms`，实测 ~47 Hz。

## 五、运行方式

```bat
start.bat          :: 构建(若缺)+启动仿真服务器 + 启动 Vite
```
浏览器打开 `http://localhost:5173`，WebSocket 自动连接 `ws://127.0.0.1:18098/ws`。
单独回归：`python tools/verify_e2e.py --port 18098`

## 六、已知边界（透明声明）

- 速度环默认增益 Kp=0.5 / Ki=5.0 / 限幅 2 N·m（Adapter 层，复用 upstream pi_control）。
- 物理上限：24 V 母线 + R=1 Ω，iq 电压饱和后电磁转矩约 ≤0.24 N·m，故 1000 rpm 爬坡约需数十仿真秒（2× 倍速下墙钟约 20~40 s）。
- 仿真倍速 `speed_scale` 默认 2（受 CPU 步进吞吐约束，实测上限约 5×）。
- 前端 E2E 为浏览器人工验收；后端 17 项已自动化全绿。
