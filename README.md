# GARGANTUA — Schwarzschild Black Hole Raytracer

全屏实时 Schwarzschild 黑洞零测地线追踪器。原生 HTML/CSS/JS + ES Modules +
本地 Three.js（无构建、无 CDN、无外部请求），任何静态服务器即可运行。

```
主体不是贴图或几何伪造：全屏 Fragment Shader 对每个像素实时 RK4 积分
Schwarzschild 零测地线  d²x/dλ² = −1.5·h²·x/r⁵  (rs = 1)
```

## 启动

```bash
cd gargantua
python3 -m http.server 8080        # 或 npx serve / 任意静态服务器
# 打开 http://localhost:8080/
```

要求 WebGL2（2017 年后所有主流浏览器）。Retina/移动端自动适配。

## 物理内容（全部为实时计算）

| 特征 | 实现 |
|---|---|
| 事件视界 | rs=1 捕获判定，出射为纯黑（仅叠加前向盘发射） |
| 光子环 | r=1.5 rs 光子球 + 临界 impact parameter b=√27/2≈2.598 rs，近临界光线长路径自然增亮 |
| 多次盘穿越 | 每条光线最多 4 次赤道面穿越、前向混叠合成（主像 + 次级像 + 高阶像） |
| 引力透镜 | 星空按弯曲后出射方向采样（Einstein 环自动出现） |
| Doppler 增亮 | 开普勒轨道速度 β=√(M/(r−2M))，δ=√(1−β²)/(1−β·n̂)，强度 ∝ δ^n（n 可调 0–4） |
| 引力红移 | g_grav=√(1−rs/r_e)/√(1−rs/r_cam)，作用于色温（Planck 黑体位移）与亮度 |
| 吸积盘 | Shakura–Sunyaev 温度分布 T∝r^(−3/4)(1−√(r_in/r))^(1/4)，Planck 辐射取色 |
| 盘湍流 | 双相位流动噪声（差速剪切不发散），fbm + 脊状细节 |
| 星空/银河 | 两层抖动网格程序星点 + Planck 色温 + fbm 银河带/尘埃带/银心 |

后处理：半浮点 HDR 渲染 → 软膝 bright-pass → 5–6 级下/上采样 bloom →
径向色散 + ACES 色调映射 + 暗角 + 胶片颗粒 + 抖动去带。

## 操作

| 按键 | 功能 |
|---|---|
| 鼠标拖拽 / 滚轮 | 自由环绕 / 缩放（OrbitControls，带阻尼） |
| **0–9** | 调试视图（合成 / 步数 / 盘穿越次数 / Doppler g / 引力因子 / 盘发射 / 纯星空 / bloom 缓冲 / 偏折角 / 湍流） |
| **⇧1–4** | 视角预设：VOYAGER / INTERSTELLAR / POLAR / PHOTON RING（`[` `]` 循环） |
| **C** | 电影镜头循环（96 s 样条环绕 + 手持漂移 + 滚转） |
| **Space** | 冻结/恢复盘时间 |
| **P / H** | 参数面板 / HUD |
| **M** | 氛围音乐（WebAudio 程序合成：次声无人机 + 太阳风噪声 + 稀疏钟音） |
| **S** | 截图 PNG |
| **F / R** | 全屏 / 重置参数 |
| **Q / W / E** | 质量档 Standard / High / Cinematic |

## 21 项参数（P 面板，localStorage 持久化）

GEOMETRY：diskInner、diskOuter
DISK：diskDensity、diskTemp、diskSpeed、turbulence、turbScale
RELATIVITY：doppler（束流指数）、redshift（引力红移混合）
SKY：starBrightness、starDensity、milkyWay
CAMERA：fov、timeScale
POST：exposure、bloomStrength、bloomRadius、bloomThreshold、grain、vignette、dispersion

质量档：

| 档 | 渲染尺度 | DPR 上限 | 积分步数 | Bloom 级数 |
|---|---|---|---|---|
| Standard | 0.72× | 1.5 | 280 | 4 |
| High | 1.0× | 2.0 | 380 | 5 |
| Cinematic | 1.15×（超采样） | 2.0 | 520 | 6 |

持续 <22 FPS 自动降档一次（toast 提示）；GPU 上下文丢失自动重建整个渲染栈。

## URL 自动化（截图/CI 接口）

```
http://localhost:8080/?shot=1&frames=20&view=1&quality=cinematic&t=12.5&hideui=1
  shot=1          渲染 frames 帧后自动截图（下载 + window.__GARGANTUA_SHOT__ = dataURL）
  frames=N        预热帧数（默认 8）
  w= / h=         画布尺寸
  view=0–3        相机预设（固定机位，保证可复现）
  quality=…       standard | high | cinematic
  debug=0–9       调试视图
  t=12.5          冻结盘时间（可复现湍流相位）
  hideui=1        隐藏 HUD/面板
  p_<参数>=值     覆盖任意 21 项参数（如 p_bloomStrength=1.2）
  nodl=1          不自动下载
  reset=1         忽略 localStorage
```

截图就绪时 console 打印 `[gargantua] {"type":"gargantua-shot-ready",…}`，
并设置 `window.__GARGANTUA_READY__ = true`（可配合任意 headless 浏览器轮询）。

运行时 API：`window.GARGANTUA = { version, ready, params, setParam, setQuality, setView, setDebug, screenshot, reset }`

## 测试

> 部署到 GitHub Pages 的运行版仅含网站本体；以下测试脚本位于开发环境（`js/test/`、`test.html`），需克隆完整开发仓库后运行。

```bash
node js/test/run.mjs           # 16 项：物理（CPU 镜像）+ GLSL 静态校验 + 状态/URL
node js/test/glslang-check.mjs  # glslangValidator 对全部 7 个 shader 做真实语义验证
node js/test/glsl-parse.mjs     # @shaderfrog/glsl-parser AST 解析
node js/test/cpu-preview.mjs   # CPU 参考渲染 4 视角 + 像素级验收指标
# 浏览器：打开 /test.html
```

已验证的物理基准（CPU 镜像 = GPU 同款积分器）：

- 光子球 r=1.5 rs 圆轨道稳定（RK4 漂移 <0.02 rs over π 弧度）
- 阴影临界 b_crit 实测 2.597–2.598 rs（理论 √27/2 = 2.5981）
- 弱场偏折 b=15 rs 实测 ∈ 0.10–0.18 rad（理论 2rs/b = 0.133）
- ISCO(r=3rs) 轨道速度 = 0.500 c（教科书值）；光子球 → c
- 次级盘像：掠临界光线在黑洞背面 r≈5.6 rs 处穿越盘面
- Doppler 不对称：4 视角左右亮度比 1.27–1.58（趋近侧亮）

## 结构

```
gargantua/
├── index.html            入口（importmap → 本地 three）
├── test.html             浏览器端测试页
├── css/style.css         静谧控制台风格 UI
├── js/
│   ├── main.js           编排：循环/截图/上下文恢复/自动化 API
│   ├── core/
│   │   ├── engine.js     渲染器 + HDR/后处理管线 + 质量档
│   │   ├── camera.js     电影样条 + OrbitControls + 预设
│   │   ├── params.js     21 参数 schema（单一所有者）
│   │   ├── state.js      localStorage + URL 解析
│   │   ├── hud.js        HUD/工具栏/面板/帮助
│   │   ├── input.js      快捷键（单一键盘所有者）
│   │   └── audio.js      WebAudio 程序化氛围乐（无音频文件）
│   ├── shaders/
│   │   ├── blackhole.glsl.js   测地线追踪主 shader（GLSL ES 1.00）
│   │   └── post.glsl.js        bright/down/up/composite
│   ├── physics/geodesic.js     CPU 镜像积分器（测试基准）
│   └── test/             测试套件 + CPU 参考渲染
└── vendor/               three r160.1 + OrbitControls（MIT，本地化）
```

音频说明：氛围音乐为 WebAudio 实时合成（振荡器 + 滤波噪声 + 调度钟音），
因此本项目零二进制资源、零网络请求，vendor 仅 three.js。
