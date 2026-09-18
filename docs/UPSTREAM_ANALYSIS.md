# UPSTREAM_ANALYSIS.md — markisus/motor_sim 上游分析

> 本地路径：`D:\user_project\git\bldc_sim\motor_sim`
> 上游版本：BIRO Motor Simulator（bazel 构建，SDL+ImGui 桌面 GUI）
> 分析日期：2026-09-18
> 结论依据：逐文件阅读 `config/ board/ controls/ simulator/ util/` 全部源码（gui.cpp 除外，见 §19）

---

## 1. 项目结构

```text
motor_sim/
├── board/        板级模型：母线电压、PWM、栅极（含死区）
├── config/       scalar.h —— using Scalar = double
├── controls/     FOC 电流环、PI 控制器、六步换相、SVM/PWM 调制
├── examples/     依赖示例（不用）
├── experiments/  单相模型实验（不用）
├── global_debug/ 调试宏（仅被 svm.cpp include 头文件，未实际调用）
├── simulator/    motor.cpp / motor_state.cpp（电机模型）+ gui.cpp / simulator.cpp（GUI 壳）
├── third_party/  Eigen（已 vendored，核心唯一第三方依赖）、SDL/ImGui/implot（GUI 用）
├── util/         Clarke 变换、旋转、正弦级数、时间、滚动缓冲、量化
└── wrappers/     SDL 封装（GUI 用，不用）
```

## 2. BLDC / PMSM 模型位置

- `simulator/motor_state.h/.cpp`：`MotorParams` / `MotorState` / `MotorKinematicState` / `MotorElectricalState`
- `simulator/motor.h/.cpp`：`step_motor()`（每 dt 一步的电气+运动学积分）

**说明：上游是统一的 PMSM/BLDC 混合模型**——反电动势由 `normed_bEmf_coeffs`（5 项奇次正弦傅里叶系数）定义：

- 仅一次项非零（默认 `0.01`）→ 正弦波 PMSM
- 设置高次项 → 梯形波（BLDC）反电动势
- 默认参数：4 对极、转子惯量 0.1 kg·m²、相电感 1 mH、相电阻 1.0 Ω

## 3. 电气模型

`step_motor_electrical()`（motor.cpp:87）：相电压 = 极电压 − 中性点电压；
`di/dt = ((V_pole − V_pole_zs) − (bEmf − bEmf_zs) − R·i) / L`；前向欧拉积分电流。

## 4. 机械模型

`step_motor_kinematic()`（motor.cpp:106）：

```text
torque = Σ(i_phase · normed_bEmf_phase)   ← 电磁转矩
       + cogging_torque（齿槽，默认全 0）
       + load_torque                       ← ⚠️ 与电磁转矩同号相加
rotor_angular_accel = torque / rotor_inertia
rotor_angle ∈ [0, 2π) 电周期机械角
```

⚠️ 注意：`kinematic.torque` 是**含负载的总转矩**。电磁转矩（不含负载）=
`phase_currents · normed_bEmfs` 点积——两者均为 upstream 已有状态字段，Adapter 直接读取字段做点积展示（§20：属"读 upstream 数据"，非重实现物理）。

## 5. FOC 实现位置

`controls/foc.h/.cpp`：

- `get_desired_current_qd(torque, normed_bEmf0)`：转矩 → 目标 iq（id=0）
- `step_foc_current_controller()`：Clarke 相电流 → Park（复数旋转，q 轴电角度）→ id/iq 双 PI → `voltage_qd`
- `FocState`（foc_state.h）：电流环周期 10 kHz、id/iq PI 上下文、输出 `voltage_qd`

## 6. Clarke / Park 实现

- Clarke：`util/clarke_transform.h/.cpp`，功率不变变换（kClarkeScale = √(2/3)），3×3 与 2×3 矩阵
- Park：`util/rotation.h` `get_rotation(angle)` 复数旋转；q 轴角 = 电角度 − π/2（motor_state.h `kQAxisOffset`）
- 逆 Park：simulator.cpp:138 直接用 `get_rotation(q_axis_angle) * voltage_qd`（复数乘法即逆变换）

## 7. Current Loop

`pi_control.h/.cpp`：`pi_control(params, ctx, dt, actual, target)`（P+I+bias）、`pi_unwind`（反算退饱和）。
电流环 PI 参数由 `make_motor_pi_params(bandwidth, R, L)` 生成（极点配置：Kp=L·bw, Ki=R·bw，上游默认带宽 10 kHz）。

## 8. Speed Loop

> **❌ 上游不存在速度环。**

上游唯一控制入口是 `SimState::foc_desired_torque`（目标**转矩**，SimState.h:31）。
控制链为：目标转矩 → FOC 电流环 → 电压 → PWM → 电机。没有任何"目标转速"概念。

**处理方式（本项目唯一超出 upstream 的控制逻辑，放 Adapter 层）：**
MotorForge 的 `simulation.target_speed` 由 Adapter 层速度 PID 实现（V1.1 起协议单位为
rad/s，范围 [0, 400]；V1.1 新增 Kd 项，kd=0 等价纯 PI）：

```text
target_speed [rad/s] → speed PID（复用 upstream 的 pi_control/pi_unwind + Adapter 级 D 项）
                  → 目标转矩 [Nm, 限幅]
                  → upstream get_desired_current_qd() → upstream FOC（原样）
```

- 不修改 upstream 任何文件；速度环 PI 直接 include 并调用 `controls/pi_control.h`
- 同时保留 **Torque 模式**（直通 upstream 原生 `foc_desired_torque`），Speed 模式为默认
- Dashboard 中速度环显示 Speed Error / 目标 iq；id/iq PI 内部 err/integral 来自 upstream `FocState`（可直接读）

## 9. PWM / SVPWM

- `board/pwm_state.h`：15 kHz 三角载波，`duties > level` 生成栅极命令，支持量化分辨率
- `controls/space_vector_modulation.cpp`：`get_pwm_duties(bus_voltage, voltage_ab)` 六扇区 SVM → 三相占空比
- `board/gate_state.h`：死区 2·dt、续流二极管模型、`get_pole_voltages()` 极电压合成

## 10. Rotor State

`MotorKinematicState`：`rotor_angle`（rad，机械，[0,2π)）、`rotor_angular_vel`（rad/s）、`rotor_angular_accel`、`torque`。

## 11. Motor State

见 §2/§4。⚠️ 已知上游瑕疵：`MotorParams::cogging_torque_map`（`std::array<Scalar,3600>`）**无初始化器**，`init_motor_state()` 也不清零 → 读到未定义值参与转矩积分。Adapter 在构造状态时将其**清零**（状态初始化，非数学修改），并在文档登记。

## 12. Simulation Timestep

- `SimState::dt = 1e-6 s`（1 MHz，**不可改**）
- GUI 循环每帧跑 `step_multiplier`（默认 100）步 ≈ 0.1 ms 仿真时/帧
- FOC 周期 10 kHz（每 100 个 dt 跑一次电流环）；PWM 周期 15 kHz；死区 2 µs

MotorForge 后端在独立仿真线程按**墙钟实时**推进：每 wall-tick 执行 `elapsed_real_time / dt` 步（上限钳制防雪崩），仿真时间独立累积，Pause 即停步。

## 13. 参数定义（MotorParams / BoardState，单位原样）

| 参数 | 字段 | 默认值 | 单位 |
|---|---|---|---|
| 极对数 | `num_pole_pairs` | 4 | - |
| 转子惯量 | `rotor_inertia` | 0.1 | kg·m² |
| 相电感 | `phase_inductance` | 1e-3 | H |
| 相电阻 | `phase_resistance` | 1.0 | Ω |
| bEmf 一次项（≈Kt/Ke） | `normed_bEmf_coeffs(0)` | 0.01 | N·m/A ≈ V·s/rad(电) |
| 母线电压 | `board.bus_voltage` | 24 | V |
| PWM 频率 | `pwm.period` | 1/15000 | s（15 kHz） |
| FOC 频率 | `foc.period` | 1/10000 | s（10 kHz） |
| 仿真步长 | `dt` | 1e-6 | s（只读） |

⚠️ 上游没有独立的 Kt/Ke/摩擦/粘滞阻尼字段——摩擦与阻尼不在模型中（见 §16 Unavailable）。

## 14. 控制输入

| 输入 | 字段 | MotorForge 映射 |
|---|---|---|
| 目标转矩 | `foc_desired_torque` | Torque 模式直通；Speed 模式由速度环生成 |
| 负载转矩 | `load_torque` | load.configure（manual/periodic） |
| 母线电压 | `board.bus_voltage` | motor.parameter |
| 相电阻/电感 | `params.*` | motor.parameter（同时按 `make_motor_pi_params` 重算电流环增益，同上游 simulator.cpp:28 行为） |
| 极对数/惯量 | `params.*` | motor.parameter |
| 换相模式 | `commutation_mode` | V1 固定 FOC（Manual/SixStep 不暴露） |

## 15. 输出数据（Available Data）

`simulation.state`（同一时刻统一采样，全部来自 `SimState`）：

| MotorForge 字段 | upstream 来源 |
|---|---|
| `timestamp`（仿真时间 s） | `state.time` |
| `rotor.angle` | `kinematic.rotor_angle`（rad→°，仅展示层换算单位） |
| `rotor.mechanicalSpeed` | `kinematic.rotor_angular_vel`（rad/s→RPM，×60/2π） |
| `rotor.electricalAngle` | `get_electrical_angle()`（upstream 函数复用） |
| `electrical.phaseA/B/C` | `electrical.phase_currents` |
| `electrical.id/iq` | Park(相电流) —— 用 upstream `clarke_transform` + `get_rotation` 复合（与 foc.cpp 内部完全同式） |
| `electrical.vd/vq` | `foc.voltage_qd`（imag/real） |
| `mechanical.torque`（总） | `kinematic.torque` |
| `mechanical.emTorque`（电磁） | `phase_currents · normed_bEmfs`（字段点积） |
| `mechanical.loadTorque` | `state.load_torque`（含周期负载控制器实时值） |
| `control.targetSpeed/speedError` | Adapter 速度环 |
| `control.targetIq` | `get_desired_current_qd()` 返回值（upstream 函数复用） |
| `control.targetTorque` | 速度环输出 / 手动目标 |
| `pwm.dutyA/B/C` | `board.pwm.duties` |
| `foc.iqErr/iqIntegral/idErr/idIntegral` | `foc.iq_controller / id_controller` |

## 16. Unavailable Data（一律 N/A，禁止伪造）

- 摩擦转矩、粘滞阻尼系数（模型中不存在）
- Kt / Ke 独立字段（由 `normed_bEmf_coeffs(0)` 体现，前端标注为 "bEmf0"）
- 相电压（只输出极电压可推，但 upstream 未存——不推）
- 编码器/噪声/温度模型

## 17. 现有测试

`controls/pi_control_test.cpp`、`space_vector_modulation_test.cpp`、`util/{quantization,sine_series,clarke_transform}_test.cpp`（gtest，bazel）。保留原文件不动；V1 后端自带 `verify_e2e.py` 做 E2E 回归（见 tools/）。

## 18. 可直接复用的代码（零修改）

`config/scalar.h`、`board/{board_state,pwm_state,gate_state}.h`、`controls/{foc,pi_control,space_vector_modulation,six_step}`、`simulator/{motor,motor_state,sim_state}`、`util/{clarke_transform,rotation,conversions,math_constants,sine_series,quantization,time}`。构建仅需 vendored Eigen，**不需要** SDL/ImGui/absl（absl 仅 gui.cpp 用）。

## 19. 必须通过 Adapter 暴露的代码

- 上游 `simulator.cpp` 是 SDL 主循环，不可复用 → Adapter 重写仿真循环（逐行对照原循环：PWM→gate→pole_voltages→step_motor→time+=dt，FOC 分支原样保留）
- `gui.cpp/.h`（VizData/rolling buffers）不进 server
- Speed 模式（§8）、周期负载控制器（基于 `state.time`）、JSON/WS 序列化均为 Adapter 层新代码

## 20. upstream 不可修改的核心代码

`motor.cpp / motor_state.cpp / foc.cpp / pi_control.cpp / space_vector_modulation.cpp / six_step.cpp / board/*.h / util/*` —— 一行不改。唯一登记的 Adapter 侧动作：构造 `SimState` 后清零 `cogging_torque_map`（修未初始化内存，非数学行为变更）。

---

## 21. 数据一致性设计（spec §9）

后端在**仿真线程内同一时刻**拷贝 `SimState` → 组装一条 `simulation.state` JSON → WS 广播（50 Hz 节流，仿真内部仍 1 MHz 步进）。前端 Dashboard / Oscilloscope / Three.js / CSV 全部消费同一 message。转子角度不累加、PWM 不重算、负载不前端合成。
