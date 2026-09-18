# MotorForge V1

## 基于 markisus/motor_sim 的 Web BLDC/PMSM 电机控制仿真实验平台

---

# 一、项目定位

开发一个独立的 Web 电机仿真与控制实验平台，暂定名称：

**MotorForge**

项目核心目标：

> 基于 `markisus/motor_sim` 已有的 BLDC/PMSM 电机模型和 FOC 控制实现，构建一个现代化 Web 交互界面，通过 React + TypeScript + Vite + Three.js 实现真实电机结构可视化、转子实时运动、速度环/电流环状态展示、PWM/电流/转速等实时数据监控，以及可控机械负载扰动实验。

第一版重点不是重新开发电机仿真算法，而是：

> **严格复用 `markisus/motor_sim` 的现有电机数学模型和控制算法，在其上增加 Web UI、3D 可视化、实验控制、实时数据展示和数据记录能力。**

---

# 二、最重要的开发原则

## 2.1 严格复用 upstream

上游项目：

```text
markisus/motor_sim
```

必须作为：

> **Motor Simulation Core / Upstream Engine**

第一版严禁重新实现：

* BLDC 数学模型
* PMSM 数学模型
* FOC
* Clarke Transform
* Park Transform
* Inverse Park
* Current Loop
* Speed Loop
* 电磁转矩计算
* 反电动势模型
* 转子动力学模型

如果 upstream 已经实现某个功能：

> 必须优先复用。

如果 upstream 的代码结构不适合直接对外提供接口：

> 可以增加 Adapter / Wrapper / API 层。

但是：

> **不得修改 upstream 核心数学模型以适应前端。**

---

# 三、第一版明确不做什么

V1 不做：

1. 完整 EtherCAT 协议实现
2. CiA402 完整实现
3. 工业级 Servo Drive
4. 完整 FEM 电磁场仿真
5. 自己实现一套 BLDC/PMSM
6. 自己实现一套 FOC
7. 完整机器人动力学
8. MuJoCo 集成
9. 真实硬件控制

这些作为后续扩展。

V1 的定位是：

> **Web-based BLDC/PMSM motor control simulation laboratory**

---

# 四、整体技术架构

```text
                         Browser
                            │
             ┌──────────────┴──────────────┐
             │                             │
          React                      Three.js
        TypeScript                    3D Motor
             │                             │
             └──────────────┬──────────────┘
                            │
                        WebSocket
                            │
                            ▼
                  C++ Motor Simulation Server
                            │
                       Thin Adapter
                            │
                            ▼
                  markisus/motor_sim
                            │
             ┌──────────────┼──────────────┐
             │              │              │
           BLDC           PMSM            FOC
             │              │              │
             └──────────────┼──────────────┘
                            │
                       Motor Dynamics
                            │
                           Rotor
```

前端：

```text
React
TypeScript
Vite
Three.js
```

后端：

```text
C++
```

电机仿真核心：

```text
markisus/motor_sim
```

---

# 五、推荐项目结构

根据 upstream 实际目录结构进行适配，不要为了套目录而大规模重构原项目。

推荐：

```text
motorforge/
│
├── motor-core/
│   ├── upstream/
│   │   └── motor_sim/
│   │
│   ├── adapter/
│   │   ├── motor_adapter.*
│   │   ├── state_adapter.*
│   │   └── parameter_adapter.*
│   │
│   ├── simulator/
│   │   ├── simulation_controller.*
│   │   ├── load_controller.*
│   │   └── experiment_controller.*
│   │
│   └── server/
│       ├── websocket_server.*
│       └── main.*
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── motor/
│   │   ├── controls/
│   │   ├── charts/
│   │   ├── three/
│   │   ├── websocket/
│   │   ├── stores/
│   │   └── types/
│   │
│   ├── package.json
│   └── vite.config.ts
│
├── configs/
│   ├── motors/
│   └── experiments/
│
├── docs/
│
├── scripts/
│
├── start.bat
│
└── README.md
```

如果 upstream 自身目录结构不同：

> 优先保持 upstream 原结构，通过最小侵入方式增加 `adapter`、`server` 等外围代码。

---

# 六、开发第一步：完整分析 upstream

OpenCode 在正式开发前必须首先完整阅读：

```text
markisus/motor_sim
```

**不要直接开始写前端。**

首先生成：

```text
docs/UPSTREAM_ANALYSIS.md
```

必须分析：

```text
1. 项目结构
2. BLDC 模型位置
3. PMSM 模型位置
4. 电气模型
5. 机械模型
6. FOC 实现位置
7. Clarke/Park 实现
8. Current Loop
9. Speed Loop
10. PWM/SVPWM
11. Rotor state
12. Motor state
13. Simulation timestep
14. 参数定义
15. 控制输入
16. 输出数据
17. 现有测试
18. 可以直接复用的代码
19. 必须通过 Adapter 暴露的代码
20. upstream 中不能修改的核心代码
```

分析完成后再开始实现。

同时明确列出：

```text
Available Data
Unavailable Data
Required Adapter
Required Wrapper
```

如果某项数据 upstream 没有：

> 不允许通过前端伪造。

---

# 七、BLDC/PMSM 模型

V1 至少支持 upstream 已有的：

```text
BLDC
PMSM
```

具体支持范围以 upstream 实际实现为准。

电机参数至少需要能够展示：

```text
Bus Voltage
Phase Resistance
Phase Inductance
Pole Pairs
Torque Constant
Back EMF Constant
Rotor Inertia
Friction
Damping
Load Torque
PWM Frequency
```

但是：

> 参数名称、单位、数据类型必须以 upstream 实际定义为准。

不得自行改变单位。

---

# 八、统一 Simulation State

后端向前端提供统一状态：

```ts
interface MotorState {
    timestamp: number;

    motorType: "BLDC" | "PMSM";

    rotor: {
        angle: number;
        mechanicalSpeed: number;
        electricalAngle: number;
    };

    electrical: {
        phaseA: number;
        phaseB: number;
        phaseC: number;

        id: number;
        iq: number;

        vd: number;
        vq: number;
    };

    mechanical: {
        torque: number;
        loadTorque: number;
    };

    control: {
        targetSpeed: number;
        speedError: number;
        targetIq: number;
        targetId: number;
    };

    pwm: {
        dutyA: number;
        dutyB: number;
        dutyC: number;
    };
}
```

这是目标统一接口，不代表所有字段都必须存在。

如果 upstream 没有某个字段：

```text
N/A
```

或：

```text
null
```

禁止前端自己推导出一个“看起来正确”的数据。

---

# 九、数据一致性

这是整个项目的重要原则。

所有：

```text
Speed
Torque
Current
Rotor Angle
Id
Iq
PWM
Load
```

必须来自同一个 simulation state / simulation timestamp。

禁止：

```text
Speed → backend simulation
Torque → frontend 自己计算
Rotor Angle → Three.js 自己累加
```

正确：

```text
                   Simulation
                       │
                 Simulation State
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      Speed          Torque         Angle
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                    Frontend
```

---

# 十、仿真时间与刷新频率

必须区分：

## Simulation timestep

由 upstream 决定。

不能为了浏览器刷新而修改。

## Network rate

建议：

```text
30~100 Hz
```

## UI refresh

建议：

```text
30~60 FPS
```

架构：

```text
Motor Simulation
      │
  High Frequency
      │
      ▼
State Buffer
      │
  WebSocket
      │
 30~100 Hz
      │
      ▼
Frontend
      │
 30~60 FPS
```

前端必须采用 Store / Ring Buffer 等方式处理高频数据。

不要每一个 WebSocket message 都导致整个 React 页面重新渲染。

---

# 十一、WebSocket API

提供：

```text
ws://localhost:<port>/ws
```

## Client → Server

### 启动

```json
{
  "type": "simulation.start"
}
```

### 停止

```json
{
  "type": "simulation.stop"
}
```

### 暂停

```json
{
  "type": "simulation.pause"
}
```

### 恢复

```json
{
  "type": "simulation.resume"
}
```

### 复位

```json
{
  "type": "simulation.reset"
}
```

### 设置目标速度

```json
{
  "type": "simulation.target_speed",
  "value": 1000
}
```

### 手动负载

```json
{
  "type": "load.configure",
  "mode": "manual",
  "torque": 0.5
}
```

### 周期负载

```json
{
  "type": "load.configure",
  "mode": "periodic",
  "torque": 0.5,
  "on_duration": 1.0,
  "off_duration": 1.0,
  "enabled": true
}
```

### 修改电机参数

```json
{
  "type": "motor.parameter",
  "name": "bus_voltage",
  "value": 24
}
```

---

# 十二、Server → Client

### 实时状态

```json
{
  "type": "simulation.state",
  "data": {}
}
```

### 仿真状态

```json
{
  "type": "simulation.status",
  "status": "running"
}
```

### 负载状态

```json
{
  "type": "load.state",
  "data": {
    "enabled": true,
    "mode": "periodic",
    "torque": 0.5,
    "phase": "on",
    "phase_time": 0.28,
    "phase_remaining": 0.72
  }
}
```

### 错误

```json
{
  "type": "simulation.error",
  "message": "..."
}
```

---

# 十三、Three.js 三维电机

使用 Three.js 建立参数化电机模型。

第一版不要求 CAD 级精度。

至少包含：

```text
Motor
├── Housing
├── Stator
│   ├── Stator Core
│   └── Coils
│
└── Rotor
    ├── Rotor Core
    └── Permanent Magnets
```

---

# 十四、真实转子运动

Three.js 转子必须根据：

```text
simulation.rotor.angle
```

旋转。

禁止：

```js
rotation += fixedSpeed;
```

来假装电机转动。

正确：

```text
motor_sim
    ↓
Rotor Angle
    ↓
WebSocket
    ↓
Frontend
    ↓
Three.js Rotor
```

三维运动必须和真实仿真状态同步。

---

# 十五、实时速度显示

UI 必须明显显示：

```text
ACTUAL SPEED

982 RPM
```

同时显示：

```text
Target Speed
Actual Speed
Speed Error
```

例如：

```text
Target: 1000 RPM
Actual: 982 RPM
Error: 18 RPM
```

---

# 十六、速度环

提供：

```text
Target Speed
```

支持：

```text
0 RPM
500 RPM
1000 RPM
1500 RPM
3000 RPM
```

也支持自定义。

显示：

```text
Target Speed
Actual Speed
Speed Error
Iq Reference
```

如果 upstream 提供 PID 内部数据，可以显示：

```text
P
I
D
Output
```

如果没有：

> 不要自行重新实现 PID，只显示已有数据。

---

# 十七、电流环

实时显示：

```text
Id Target
Id Actual

Iq Target
Iq Actual
```

同时显示：

```text
Ia
Ib
Ic
```

如果 upstream 提供 PID 输出，也显示：

```text
Id PID Output
Iq PID Output
```

---

# 十八、PWM

如果 upstream 能提供 PWM：

显示：

```text
PWM A
PWM B
PWM C
```

同时可以显示 PWM waveform。

重要：

> PWM 数据必须来自真实仿真状态。

禁止用 CSS / Canvas 动画制造假的 PWM。

如果 upstream 无法提供 PWM：

```text
PWM = N/A
```

不要伪造。

---

# 十九、实时 Dashboard

建议 UI：

```text
┌─────────────────────────────────┐
│ Motor Status                    │
├─────────────────────────────────┤
│ Speed       982 RPM             │
│ Target      1000 RPM            │
│ Error        18 RPM             │
│ Torque       0.43 Nm            │
│ Load         0.50 Nm            │
│                                 │
│ Ia            2.13 A            │
│ Ib           -1.02 A            │
│ Ic           -1.11 A            │
│                                 │
│ Id            0.03 A            │
│ Iq            2.08 A            │
│                                 │
│ Vd            0.12 V            │
│ Vq            8.43 V            │
│                                 │
│ PWM A        52.1 %             │
│ PWM B        31.4 %             │
│ PWM C        16.5 %             │
│                                 │
│ Rotor        127.3°             │
└─────────────────────────────────┘
```

具体字段必须以 upstream 实际可提供数据为准。

---

# 二十、负载阻力控制

前端提供：

```text
Load Torque
```

单位：

```text
Nm
```

不要使用容易产生歧义的：

```text
Rotor Resistance
```

来表示机械负载。

提供：

```text
0.0 Nm
0.1 Nm
0.2 Nm
0.5 Nm
1.0 Nm
```

以及自定义输入。

---

# 二十一、手动负载

UI：

```text
Manual Load

Load Torque [0.50] Nm

[Apply]
```

数据链路：

```text
Frontend
    ↓
load.configure
    ↓
WebSocket
    ↓
C++ Adapter
    ↓
motor_sim
    ↓
Mechanical Dynamics
```

禁止前端直接修改：

```text
Speed
Angle
Acceleration
```

负载只能通过真正的机械动力学进入系统。

---

# 二十二、周期性负载

提供：

```text
Periodic Load
```

开关：

```text
☐ Enable Periodic Load
```

参数：

```text
Load Torque     [0.50] Nm
ON Duration     [1.00] s
OFF Duration    [1.00] s
```

默认：

```text
ON  = 1 s
OFF = 1 s
```

效果：

```text
Time

0s      1s      2s      3s      4s
│───────│───────│───────│───────│

0 Nm    ON      OFF     ON      OFF
        0.5Nm
```

---

# 二十三、周期扰动必须基于 Simulation Time

不要使用：

```js
setInterval()
setTimeout()
```

作为物理实验的时间基准。

正确：

```text
Simulation Time
       ↓
Periodic Load Controller
       ↓
Current Load Torque
       ↓
motor_sim
```

如果：

```text
Pause
```

那么：

> 仿真时间和周期负载必须同时暂停。

如果：

```text
Resume
```

则继续。

如果：

```text
Reset
```

则：

```text
phase = initial
timer = 0
load = initial
```

---

# 二十四、周期负载状态

实时显示：

```text
Periodic Load: ON
Current Load: 0.50 Nm
Phase: ON
Remaining: 0.72 s
```

或者：

```text
Periodic Load: ON
Current Load: 0.00 Nm
Phase: OFF
Remaining: 0.31 s
```

---

# 二十五、负载扰动实验

最重要的实验：

```text
Target Speed = 1000 RPM
```

稳定运行。

然后：

```text
Periodic Load

Load = 0.5 Nm
ON  = 1 s
OFF = 1 s
```

观察：

```text
Load Torque
Speed
Iq
Torque
Current
```

理论上可能观察到：

```text
Load ↑
   ↓
Speed ↓
   ↓
Speed Error ↑
   ↓
Iq Reference ↑
   ↓
Motor Torque ↑
   ↓
Speed Recovery
```

但是：

> 实际曲线必须由 `markisus/motor_sim` 决定。

不得人为生成理想曲线。

---

# 二十六、实时示波器

实现 waveform viewer。

至少支持：

```text
Speed
Target Speed
Speed Error

Torque
Load Torque

Ia
Ib
Ic

Id
Iq

Vd
Vq

PWM A
PWM B
PWM C
```

建议时间窗口：

```text
10 s
5 s
2 s
1 s
500 ms
100 ms
```

支持：

* Zoom
* Pan
* Auto Scale
* Show/Hide Channel
* Pause
* Clear
* Reset

---

# 二十七、重点示波器实验

必须能够同时观察：

```text
Load Torque
Speed
Iq
Motor Torque
```

曲线具体形状完全由真实 simulation state 决定。

---

# 二十八、三相电流

显示：

```text
Ia
Ib
Ic
```

并显示：

```text
Id
Iq
```

例如：

```text
Phase Current

Ia    +2.13 A
Ib    -1.02 A
Ic    -1.11 A

d/q Current

Id    +0.03 A
Iq    +2.08 A
```

---

# 二十九、Clarke / Park 教学可视化

提供可选面板：

```text
Ia / Ib / Ic
       ↓
    Clarke
       ↓
    Iα / Iβ
       ↓
      Park
       ↓
     Id / Iq
```

显示：

```text
Rotor Electrical Angle
Iα
Iβ
Id
Iq
```

如果 upstream 已经提供对应数据：

> 使用 upstream 数据。

如果没有：

> 第一版不要重新实现这些算法，只预留接口。

---

# 三十、实验预设

至少提供：

## Experiment 1 — Speed Step

```text
0 RPM
↓
1000 RPM
```

## Experiment 2 — Load Step

```text
0 Nm
↓
0.5 Nm
```

## Experiment 3 — Periodic Load

```text
0 Nm
↓
0.5 Nm / 1s
↓
0 Nm / 1s
↓
repeat
```

## Experiment 4 — Speed + Periodic Load

```text
Target Speed = 1000 RPM

Load:
0
0.5 Nm
0
0.5 Nm
...
```

---

# 三十一、数据记录

提供：

```text
Start Recording
Stop Recording
Export CSV
```

记录：

```text
timestamp
speed
target_speed
speed_error

load_torque
motor_torque

Ia
Ib
Ic

Id
Iq

Vd
Vq

PWM_A
PWM_B
PWM_C

rotor_angle
```

数据必须来自 simulation state。

---

# 三十二、状态数据缓存

推荐：

```text
WebSocket
    ↓
Simulation Store
    ↓
Ring Buffer
    ├── Dashboard
    ├── Oscilloscope
    └── Three.js
```

Three.js：

```text
requestAnimationFrame
        ↓
读取最新 simulation state
        ↓
更新 Rotor
        ↓
render
```

---

# 三十三、UI 结构

建议：

```text
┌─────────────────────────────────────────────────────────────┐
│ MotorForge                         ● Connected   Running     │
├──────────────────────────┬──────────────────────────────────┤
│                          │ Motor Parameters                 │
│                          │                                  │
│                          │ Motor Type                       │
│       3D MOTOR           │ Bus Voltage                     │
│                          │ Resistance                       │
│         ROTOR            │ Inductance                       │
│           ↻              │ Pole Pairs                      │
│                          │ Kt / Ke                          │
│                          │ Inertia                          │
├──────────────────────────┼──────────────────────────────────┤
│                          │ Control                          │
│                          │                                  │
│                          │ Target Speed [1000 RPM]          │
│                          │                                  │
│                          │ [Start] [Pause] [Reset]          │
├──────────────────────────┼──────────────────────────────────┤
│                          │ Load Disturbance                 │
│                          │                                  │
│                          │ ○ Manual                         │
│                          │ ● Periodic                       │
│                          │                                  │
│                          │ Load [0.50] Nm                   │
│                          │ ON   [1.00] s                    │
│                          │ OFF  [1.00] s                    │
│                          │                                  │
│                          │ ☑ Enable                         │
├──────────────────────────┴──────────────────────────────────┤
│ Real-time Motor Status                                      │
│ Speed / Torque / Current / Id / Iq / PWM / Rotor           │
├─────────────────────────────────────────────────────────────┤
│                     Oscilloscope                            │
│                                                             │
│ Speed                                                       │
│ Load Torque                                                │
│ Iq                                                          │
│ Ia                                                          │
│ Ib                                                          │
│ Ic                                                          │
│ PWM                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

# 三十四、工程风格

UI 不要设计成游戏。

目标：

> **工程实验平台 / 电机控制实验室**

强调：

* 清晰
* 数据密度合理
* 实时状态明确
* 波形容易观察
* 参数容易修改
* 实验容易重复

---

# 三十五、错误处理

处理：

```text
Backend unavailable
WebSocket disconnected
Invalid parameter
Unsupported motor
Simulation error
Upstream error
```

状态：

```text
Connected
Running
Paused
Stopped
Error
```

断线后：

```text
Disconnected
```

并提供：

```text
Reconnect
```

---

# 三十六、外部 API 预留

V1 不实现完整 EtherCAT。

但是设计：

```text
Virtual Servo API
```

未来支持：

```text
set_speed()
set_torque()
set_position()
get_state()
start()
stop()
reset()
```

架构：

```text
External Controller
        │
        ▼
Virtual Servo API
        │
        ▼
Motor Simulation
```

未来再扩展：

```text
EtherCAT
CiA402
```

---

# 三十七、未来 Virtual EtherCAT Servo

不要在 V1 实现，但架构必须允许未来加入：

```text
RobotForge
    │
    ▼
Virtual EtherCAT Servo
    │
    ▼
CiA402
    │
    ▼
MotorForge
    │
    ▼
BLDC/PMSM
```

最终可以模拟：

```text
Target Position
Target Velocity
Target Torque
       │
       ▼
Virtual Servo Drive
       │
       ▼
FOC
       │
       ▼
BLDC/PMSM
       │
       ▼
Rotor
       │
       ▼
Encoder
       │
       ▼
Feedback
```

---

# 三十八、未来 RobotForge 集成

MotorForge 保持独立。

MotorForge：

```text
Motor
 ↓
Servo
 ↓
Control
 ↓
Rotor
```

RobotForge：

```text
Robot
 ↓
Joint
 ↓
Servo
 ↓
Motor
```

未来：

```text
RobotForge
     │
     ▼
Virtual Servo
     │
     ▼
MotorForge
     │
     ▼
BLDC/PMSM
```

或者：

```text
RobotForge
     │
     ▼
Real EtherCAT Servo
     │
     ▼
Real Motor
```

---

# 三十九、启动方式

提供：

```text
start.bat
```

默认：

```text
start.bat
```

执行：

1. 检查依赖
2. 启动 C++ Motor Simulation Server
3. 启动 Vite
4. 打开浏览器

开发模式：

```text
start.bat dev
```

---

# 四十、测试

必须保留 upstream 原有测试。

增加：

## Backend

测试：

```text
start
stop
pause
resume
reset

set_speed
set_load

periodic_load

parameter_update

WebSocket serialization
```

## Frontend

测试：

```text
WebSocket connection
Reconnect
State parsing
Target speed command
Load command
Periodic load
Reset
Chart buffer
```

## Integration

验证：

```text
Target Speed
    ↓
WebSocket
    ↓
C++ Adapter
    ↓
motor_sim
    ↓
Actual Speed
    ↓
WebSocket
    ↓
Frontend
    ↓
Dashboard
    ↓
Three.js
```

---

# 四十一、端到端最小验收标准

这是 V1 的**硬性验收标准**。

不能仅因为：

```text
后端可以启动
前端可以启动
Three.js 可以显示
WebSocket 可以连接
```

就认为项目完成。

必须验证完整闭环：

```text
Browser
   │
   │ Command
   ▼
WebSocket
   │
   ▼
C++ Adapter
   │
   ▼
markisus/motor_sim
   │
   ▼
Real Simulation State
   │
   ▼
WebSocket
   │
   ├── Dashboard
   ├── Oscilloscope
   └── Three.js
```

---

## E2E-01：最小启动

执行：

```bat
start.bat
```

必须：

1. 启动 C++ Motor Simulation Server
2. 启动 Vite Frontend
3. 浏览器打开 Web UI
4. WebSocket 自动连接

页面显示：

```text
Backend: Connected
Simulation: Stopped
Motor: Ready
```

---

## E2E-02：Simulation Start

浏览器点击：

```text
Start
```

必须形成：

```text
Browser
   ↓
simulation.start
   ↓
WebSocket
   ↓
C++ Server
   ↓
Simulation Controller
   ↓
motor_sim
```

然后：

```text
simulation.status = running
```

前端显示：

```text
Simulation: Running
```

---

## E2E-03：目标速度闭环

设置：

```text
Target Speed = 1000 RPM
```

点击：

```text
Apply
```

必须形成：

```text
Browser
   ↓
target_speed
   ↓
WebSocket
   ↓
C++ Adapter
   ↓
motor_sim
   ↓
Motor Simulation
```

然后：

```text
MotorState.targetSpeed = 1000 RPM
```

实际速度必须发生真实变化。

不要求实际速度必须精确达到 1000 RPM。

最小要求：

```text
Initial Speed ≠ Final Speed
```

---

## E2E-04：Three.js 转子同步

运行电机后：

```text
Rotor Angle
```

必须发生变化。

Three.js Rotor 必须同步旋转。

验证链：

```text
Simulation Rotor Angle
        ↓
WebSocket State
        ↓
Frontend State
        ↓
Three.js Rotor Rotation
```

禁止前端独立制造电机转速动画。

---

## E2E-05：手动负载闭环

设置：

```text
Target Speed = 1000 RPM
```

等待电机运行。

设置：

```text
Manual Load = 0.5 Nm
```

点击：

```text
Apply
```

必须形成：

```text
Browser
   ↓
load.configure
   ↓
WebSocket
   ↓
C++ Load Controller
   ↓
motor_sim
   ↓
Mechanical Load
```

然后：

```text
loadTorque
```

必须从：

```text
0 Nm
```

变化到：

```text
0.5 Nm
```

---

## E2E-06：负载产生真实电机响应

在：

```text
Target Speed = 1000 RPM
Load = 0.5 Nm
```

条件下观察：

```text
Speed
Iq
Motor Torque
Load Torque
```

必须看到由真实模型产生的动态响应。

不规定具体响应幅度。

但：

```text
motor_sim state
```

必须发生真实变化。

禁止：

```text
Fake Speed Drop
Fake Torque
Fake Current
```

---

## E2E-07：周期负载

设置：

```text
Target Speed = 1000 RPM

Periodic Load:
Enabled = true
Torque = 0.5 Nm
ON = 1.0 s
OFF = 1.0 s
```

运行至少：

```text
4 秒
```

必须观察到至少两个完整周期：

```text
0 Nm
↓
0.5 Nm
↓
0 Nm
↓
0.5 Nm
```

---

## E2E-08：周期负载必须使用 Simulation Time

周期负载不能使用：

```js
setInterval()
setTimeout()
```

作为物理时间基准。

必须：

```text
Simulation Time
       ↓
Periodic Load Controller
       ↓
Load Torque
       ↓
motor_sim
```

Pause 时：

```text
Simulation Time 停止
Load Phase 停止
```

Resume 时继续。

---

## E2E-09：周期负载与波形同步

示波器必须能够同时显示：

```text
Load Torque
Actual Speed
Iq
Motor Torque
```

所有波形必须来自真实 simulation state。

---

## E2E-10：Pause

运行电机后：

```text
Pause
```

必须：

```text
Simulation Time 停止增长
Rotor 停止
Speed 停止更新
Current 停止更新
Periodic Load 停止
```

例如：

```text
Pause 时：

Periodic Load remaining = 0.63 s
```

Resume 后继续：

```text
0.63 s
```

不能重新开始。

---

## E2E-11：Resume

点击：

```text
Resume
```

必须：

```text
Simulation Time 继续
Rotor 继续
Speed 继续
Current 继续
Periodic Load 继续
```

---

## E2E-12：Reset

运行：

```text
Start
→ Speed = 1000 RPM
→ Periodic Load
→ Run
```

然后：

```text
Reset
```

必须恢复：

```text
Simulation Time → 0
Speed → Initial State
Rotor Angle → Initial State
Load → Initial State
Periodic Load Phase → Initial State
Waveform → Cleared
Three.js Rotor → Initial Angle
```

---

## E2E-13：状态数据一致性

同一个：

```text
simulation.state.timestamp
```

必须对应同一次仿真状态。

禁止：

```text
Speed timestamp = T
Rotor timestamp = T-1
Torque timestamp = T-5
```

所有实时数据必须来自统一 simulation state。

---

## E2E-14：PWM 数据真实性

如果 upstream 提供：

```text
PWM A
PWM B
PWM C
```

必须显示真实数据。

链路：

```text
Simulation PWM
      ↓
Adapter
      ↓
WebSocket
      ↓
Frontend PWM
```

禁止：

```text
Frontend
    ↓
根据 Speed 自己计算 PWM
```

如果 upstream 当前版本没有 PWM：

```text
PWM = N/A
```

属于合法结果。

---

## E2E-15：实时 Dashboard

运行仿真时至少实时更新：

```text
Speed
Torque
Current
Rotor Angle
Load
```

Dashboard 不能只在点击按钮后刷新。

---

## E2E-16：WebSocket 断线

运行时停止 backend。

前端必须显示：

```text
Disconnected
```

不能继续假装：

```text
Running
```

重新启动 backend 后提供：

```text
Reconnect
```

并恢复连接。

---

# 四十二、完整最小实验验收

这是 V1 最重要的验收场景。

执行：

### Step 1

```bat
start.bat
```

### Step 2

浏览器打开 MotorForge。

### Step 3

确认：

```text
Backend = Connected
```

### Step 4

设置：

```text
Motor = BLDC
Target Speed = 1000 RPM
```

### Step 5

点击：

```text
Start
```

### Step 6

确认：

```text
Rotor rotating
Actual Speed changing
```

### Step 7

启用：

```text
Periodic Load

Torque = 0.5 Nm
ON = 1 s
OFF = 1 s
```

### Step 8

运行：

```text
至少 4 秒
```

### Step 9

同时观察：

```text
3D Rotor

Target Speed
Actual Speed
Speed Error

Load Torque
Motor Torque

Ia
Ib
Ic

Id
Iq

PWM A
PWM B
PWM C
```

以及：

```text
Oscilloscope

Load Torque
Speed
Iq
Torque
```

### Step 10

点击：

```text
Pause
```

确认：

```text
Simulation Time 停止
Rotor 停止
Periodic Load 停止
```

### Step 11

点击：

```text
Resume
```

确认：

```text
Simulation 继续
Rotor 继续
Periodic Load 继续
```

### Step 12

点击：

```text
Reset
```

确认：

```text
Simulation → Initial State
Rotor → Initial State
Load → Initial State
Waveform → Cleared
```

---

# 四十三、V1 最小通过矩阵

开发完成后必须能够填写：

| 验收项                   | 结果                |
| --------------------- | ----------------- |
| `start.bat` 启动        | PASS / FAIL       |
| Browser → WebSocket   | PASS / FAIL       |
| WebSocket → C++       | PASS / FAIL       |
| C++ → motor_sim       | PASS / FAIL       |
| Target Speed 修改       | PASS / FAIL       |
| Motor 实际响应            | PASS / FAIL       |
| Rotor 3D 同步           | PASS / FAIL       |
| Manual Load           | PASS / FAIL       |
| Periodic Load         | PASS / FAIL       |
| Load → Motor Response | PASS / FAIL       |
| Speed Dashboard       | PASS / FAIL       |
| Current Dashboard     | PASS / FAIL       |
| Torque Dashboard      | PASS / FAIL       |
| PWM Dashboard         | PASS / FAIL / N/A |
| Oscilloscope          | PASS / FAIL       |
| Pause                 | PASS / FAIL       |
| Resume                | PASS / FAIL       |
| Reset                 | PASS / FAIL       |
| WebSocket Reconnect   | PASS / FAIL       |
| CSV Export            | PASS / FAIL       |

---

# 四十四、V1 最小硬性通过条件

以下链路必须 **100% 打通**：

```text
Browser
  │
  │ Set Target Speed
  ▼
WebSocket
  │
  ▼
C++ Adapter
  │
  ▼
markisus/motor_sim
  │
  ▼
Real Motor Simulation
  │
  ├── Speed
  ├── Torque
  ├── Current
  ├── Rotor Angle
  └── Load
  │
  ▼
WebSocket
  │
  ▼
Frontend
  │
  ├── Dashboard
  ├── Oscilloscope
  └── Three.js Rotor
```

同时必须完成：

```text
Target Speed
      +
Periodic Load
      +
Real Motor Response
      +
Real-time Visualization
      +
Pause / Resume / Reset
```

---

# 四十五、物理真实性要求

这是整个项目最高优先级之一。

负载必须真正进入：

```text
motor_sim
```

而不是：

```text
Frontend
 ↓
Fake Speed Drop
```

禁止任何形式的：

```text
Artificial Speed Curve
Fake Torque
Fake Current
Fake PWM
Fake Rotor Speed
Fake Load Response
```

所有这些数据必须来自：

> `markisus/motor_sim` 的真实 simulation state。

Three.js 只是：

> **可视化真实仿真结果。**

---

# 四十六、最终开发优先级

严格按照以下顺序：

## Phase 1 — Upstream Analysis

分析：

```text
markisus/motor_sim
```

生成：

```text
UPSTREAM_ANALYSIS.md
```

完成后确认：

```text
Motor Input
Motor State
Control Loop
Simulation Step
Available Output
```

---

## Phase 2 — Motor Adapter

实现：

```text
Motor
 ↓
Simulation
 ↓
State
```

首先让 C++ 侧可以独立运行。

---

## Phase 3 — 最小 E2E Backend

先不要开发完整 UI。

先实现：

```text
simulation.start
simulation.stop
simulation.pause
simulation.resume
simulation.reset
simulation.target_speed
```

通过 WebSocket 验证：

```text
Command
 ↓
motor_sim
 ↓
State
```

---

## Phase 4 — React + Vite

建立最小 Web UI。

首先只显示：

```text
Connection
Simulation Status
Speed
Rotor Angle
```

先验证：

```text
Browser
 ↓
WebSocket
 ↓
Backend
 ↓
motor_sim
 ↓
Frontend
```

---

## Phase 5 — Three.js

实现：

```text
Motor
Stator
Rotor
```

并完成：

```text
Simulation Rotor Angle
        ↓
Three.js Rotor
```

---

## Phase 6 — Control Dashboard

加入：

```text
Target Speed
Actual Speed
Speed Error
Torque
Current
Id
Iq
PWM
```

---

## Phase 7 — Manual Load

实现：

```text
Manual Load Torque
```

验证：

```text
Load
 ↓
motor_sim
 ↓
Motor Response
```

---

## Phase 8 — Periodic Load

实现：

```text
0.5 Nm
1 s ON
1 s OFF
```

必须基于：

```text
Simulation Time
```

---

## Phase 9 — Oscilloscope

加入：

```text
Speed
Torque
Load
Iq
Ia
Ib
Ic
PWM
```

---

## Phase 10 — Data Recording

实现：

```text
Start Recording
Stop Recording
Export CSV
```

---

## Phase 11 — Experiment Presets

实现：

```text
Speed Step
Load Step
Periodic Load
Speed + Periodic Load
```

---

## Phase 12 — E2E Regression

必须完整执行：

```text
Start
→ Set Speed
→ Motor Response
→ Enable Load
→ Observe Response
→ Pause
→ Resume
→ Reset
```

并填写：

```text
E2E Acceptance Matrix
```

---

## Phase 13 — Documentation

完善：

```text
README.md
UPSTREAM_ANALYSIS.md
Architecture Documentation
WebSocket API
Experiment Documentation
E2E Test Documentation
```

---

# 四十七、第一版最终架构

```text
                         MotorForge
                              │
            ┌─────────────────┴──────────────────┐
            │                                    │
       Web Frontend                         Simulation Core
            │                                    │
     React + Three.js                      C++ Adapter
            │                                    │
        WebSocket                               │
            │                                    │
            └────────────────┬───────────────────┘
                             │
                             ▼
                    markisus/motor_sim
                             │
             ┌───────────────┼───────────────┐
             │               │               │
           BLDC             PMSM             FOC
             │               │               │
             └───────────────┼───────────────┘
                             │
                       Motor Dynamics
                             │
                            Rotor
```

前端提供：

```text
3D Motor
Real-time Rotor
Speed
Torque
Load Torque
Ia / Ib / Ic
Id / Iq
Vd / Vq
PWM A / B / C
Rotor Angle
Target Speed
Speed Error
Manual Load
Periodic Load
Oscilloscope
CSV Recording
```

---

# 四十八、核心设计原则总结

整个项目必须始终遵循：

```text
                 Physics First
                      │
                      ▼
              markisus/motor_sim
                      │
                      ▼
                Adapter Layer
                      │
                      ▼
                 WebSocket
                      │
                      ▼
               React / Three.js
```

而不是：

```text
React
 ↓
Fake Motor
 ↓
Fake Speed
 ↓
Fake Current
```

最终目标不是做一个：

> “会转的 3D 电机”。

而是做一个：

> **能够通过真实 BLDC/PMSM 仿真模型观察速度环、电流环、PWM、电流、转矩、转速以及负载扰动动态响应的 Web 电机控制实验平台。**

更重要的是，必须能够通过浏览器完成完整的端到端实验：

```text
Browser
 ↓
Control Command
 ↓
WebSocket
 ↓
C++ Adapter
 ↓
markisus/motor_sim
 ↓
Real Motor Dynamics
 ↓
Simulation State
 ↓
WebSocket
 ├── Dashboard
 ├── Oscilloscope
 └── Three.js
```

未来在此基础上再扩展：

```text
MotorForge
    ↓
Virtual Servo
    ↓
EtherCAT / CiA402
    ↓
RobotForge
    ↓
MuJoCo
    ↓
Robot
```

V1 不提前实现这些未来功能，但必须保证当前架构能够自然扩展到这些方向。

**最终优先级：**

```text
真实 Simulation
    >
端到端闭环
    >
数据一致性
    >
控制逻辑正确
    >
实验可重复
    >
实时可视化
    >
3D 视觉效果
```

**如果高级 UI 功能与端到端闭环发生冲突，优先保证端到端闭环。**
