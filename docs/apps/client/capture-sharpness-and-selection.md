# 截屏 Overlay：清晰度与框选

> 记录 client 截屏标注层在 **高 DPI Windows** 上的已知问题与已验证解法。  
> 改动 `annotation.tsx` / Stage 底图 / 透明窗口相关逻辑前，请先读本文，避免回归。

---

## 1. 速查

| 目标 | 正确做法 | 禁止做法 |
|------|----------|----------|
| 画面清晰 | Stage 逻辑尺寸 = `natural / dpr`，`pixelRatio = dpr`，缓冲与 PNG **1:1** | 用 `innerWidth × dpr` 建缓冲再 stretch PNG |
| 可框选 | 底图画在 **Konva `Image`** 上（不透明像素参与命中） | HTML `<img>` 底图 + **透明** Stage |
| 减少发糊 | 底图 Layer / `Image` 设 `imageSmoothingEnabled={false}` | 依赖浏览器默认双线性插值放大 |

**关键实现：** `apps/client/src/features/capture/components/annotation.tsx`

---

## 2. 问题分类

### 2.1 画面发糊（清晰度）

**现象**

- 截图像素本身足够（例如 `2560×1600`），但 overlay 上文字/图标边缘发虚。
- 导出 PNG 也可能同样偏软。

**典型环境（实测）**

| 量 | 示例值 |
|----|--------|
| 窗口 CSS（`innerWidth × innerHeight`） | `1707 × 1067` |
| `devicePixelRatio` | `1.5` |
| 截图 PNG `naturalWidth × naturalHeight` | `2560 × 1600` |
| `naturalWidth / innerWidth` | ≈ `1.4997`（≠ 精确 `1.5`） |

**根因**

1. **亚像素再采样**  
   若 Stage 按「窗口 CSS 尺寸 × `devicePixelRatio`」分配 canvas 缓冲，再把 PNG `drawImage` 进去：
   - 缓冲宽约 `1707 × 1.5 = 2560.5`（或类似非整对齐）
   - 源图是 `2560`  
   → 多一次缩放插值，肉眼发糊。

2. **默认图像平滑**  
   Canvas / Konva 默认开启平滑，对近 1:1 或轻微缩放也会做双线性滤波，加重虚边。

**不是根因**

- 截图分辨率不够（实测缓冲可与 PNG 同为 `2560×1600`）。
- 单纯「没用 HTML img」——HTML 更锐，但会破坏框选（见 2.2）。

### 2.2 无法框选裁剪区域

**现象**

- 进入 `selecting` 后，按下拖拽无选区；Stage 收不到 `mousedown` / `mousemove`。

**根因（已验证）**

- 为清晰度试过：**HTML `<img>` 全屏底图 + 透明 Konva Stage**（仅画暗罩/选区）。
- 在 **Windows + 透明 Tauri/WebView 窗口** 下，Stage 区域几乎无可命中的不透明像素时，指针事件进不了 Konva。
- 日志特征：`mode: html-backdrop-*`、`hasKonvaBg: false`，且无 `stage select pressed`。

**不是根因**

- `SelectionOverlay` 在 `selecting` 阶段 `listening={false}`（这是预期：框选由 Stage 级 `onPress` / `onMove` 驱动）。

---

## 3. 已验证解法

### 3.1 清晰度：按截图像素反推 Stage 逻辑尺寸

```text
dpr         = max(1, devicePixelRatio)
stageWidth  = naturalWidth  / dpr
stageHeight = naturalHeight / dpr
pixelRatio  = dpr
```

则 canvas 缓冲：

```text
bufferW = stageWidth  × pixelRatio ≈ naturalWidth
bufferH = stageHeight × pixelRatio ≈ naturalHeight
```

验收指标：`canvas.width/height` 与 `img.naturalWidth/Height` 差值为 **0**（允许舍入误差时接近 0）。

### 3.2 清晰度：关闭底图平滑

底图 Layer 与 `ReImage` 均设置：

- `imageSmoothingEnabled={false}`
- `perfectDrawEnabled={false}`（底图层，减少多余离屏绘制）
- `listening={false}`（命中交给 Stage / 上层）

### 3.3 框选：底图必须在 Konva 内

- 使用 `react-konva` 的 `Image`（`ReImage`）绘制 `sourceImage`。
- **不要**用叠在 Stage 下面的 DOM `<img>` 替代视觉底图。
- 框选逻辑仍在 `capture.tsx` 的 Stage 事件：`handlePress` / `handleMove` / `handleRelease`。

### 3.4 导出

- `renderPng()` 使用与 Stage 相同的 `pixelRatio`（当前为 `dpr`），并对选区传 `x/y/width/height`。
- 导出前隐藏 transformer 与 `selection-overlay-layer`，避免把 UI 暗罩/手柄打进 PNG。

---

## 4. 已否定方案（勿再引入）

| 方案 | 清晰度 | 框选 | 结论 |
|------|--------|------|------|
| 仅 Konva 底图 + `viewport × dpr`（未对齐 PNG） | 易糊 | ✅ | 清晰度差，勿回退 |
| HTML backdrop + 透明 Stage | 更锐 | ❌ | Windows 透明窗丢命中 |
| DOM 层自做框选（绕开 Konva） | — | 曾可用 | 产品侧明确拒绝双轨，已撤回 |
---

## 5. 浮层窗口生命周期（硬约束）

| 约束 | 原因 | 违反后的现象 |
|------|------|--------------|
| overlay 窗口**常驻映射**（启动即显示），`overlay:hide` 只藏 DOM + 切穿透 | `hide()`/`show()` 会让 WebView2 挂起合成 | 按快捷键后没有遮罩、没有吸附，点一下鼠标才出来 |
| 尺寸必须按监视器**物理矩形**铺满（`apply_bounds`），不能用 `maximized` | 最大化只覆盖工作区 | 遮罩漏掉任务栏那条，且启动时窗口停在默认 800×600 |
| 真隐藏只走 `overlay:park`（渲染进程异常 / 退出） | 坏窗口不能一直吃点击 | 白屏浮层卡住桌面 |
| 出图顺序：ensure → 抓帧 → 切模式 → 首帧 ack（`capture:ready`）→ reveal | reveal 早于首帧会露出实时桌面 | 截屏瞬间闪一下桌面 |
| `capture:open` 单飞 | 连按会覆盖 pending、并把遮罩拍进新图 | 出了怪图 / 按几次才有反应 |
| 窗口区域在 `overlay_ensure` 之后枚举 | 需要浮层自己的 hwnd 与 scale factor | 首次/重建后没有窗口吸附 |

## 6. 选择器候选栈

`capture/region.rs` 产出 `CaptureRegion { x, y, w, h, kind, hwnd, title, z, control_type }`
（`kind`：`element | child | client | frame | screen`），`features/capture/region.ts` 的
`findHoverStack` 把它组织成「由细到粗」的候选栈：

- 元素链（UIA，`capture:elements`）→ 子控件（面积升序）→ 客户区 → 窗口框 → 其它窗口（z 序）→ 整屏
- **移动中不探测**：窗口级候选由本地几何实时给出；光标停住 `80ms` 后补一次元素级（`hover-probe.ts`），
  两次探测至少隔 `180ms`，查询期间又移动会收敛到最新坐标
- 候选分组/排序在 `regions` 变化时做一次（`buildRegionIndex`），mousemove 只做矩形命中
- 滚轮：逐层移动（上滚更粗）；Shift+滚轮：跳到相邻窗口组的最细一层
- UIA 查询前必须让浮层**临时穿透**，否则 `ElementFromPoint` 命中的是我们自己；穿透由 RAII guard 负责复原
- UIA 引擎常驻专用线程（`uia-probe`），不要每次查询重建 `IUIAutomation`
- UIA 超时/失败一律退化为窗口级候选，不能阻塞悬停
---

## 5. 代码地图

```text
apps/client/src/features/capture/
├── capture.tsx                 # phase、框选拖拽、工具栏
├── tauri.ts                    # fetchImageFromPath（asset 直载）
└── components/
    ├── annotation.tsx          # ★ Stage 尺寸 / pixelRatio / Konva 底图 / 导出
    ├── annotation.module.scss  # 全屏容器（勿再加拦截指针的 backdrop 层）
    ├── selection-overlay.tsx   # 暗罩与选区手柄；selecting 时 Layer listening=false
    ├── magnifier.tsx           # 放大镜（勿在高频 setState + spring 上叠导致最大更新深度）
    └── graphics.tsx            # 标注图形
```

**改动敏感点（annotation.tsx）**

- `stageWidth` / `stageHeight` / `pixelRatio` 计算公式
- 底图是否为 Konva `Image`
- `imageSmoothingEnabled`
- Stage 是否相对窗口「完全透明且无绘制像素」

---

## 6. 回归检查清单

改动截屏画布后，在 **DPR ≠ 1** 的显示器上至少验证：

1. **清晰度**  
   - 打开截屏，对比真实桌面与 overlay：文字边缘不应明显发虚。  
   - DevTools 中 Stage 下 canvas：`width/height` ≈ 截图 `naturalWidth/Height`。

2. **框选**  
   - `selecting` 阶段按住拖拽，能拉出裁剪框并进入后续阶段。

3. **导出**  
   - 框选后导出/复制，分辨率与清晰度应接近源截图对应区域。

4. **透明窗口**  
   - 勿为「更锐」改回 HTML 底图；若必须试替代渲染路径，先在本机验证指针事件。

---

## 7. 设计约束（产品 / 架构）

- 高质量 PNG，不为速度牺牲画质。
- 不叠补丁、不双轨（例如 DOM 框选 + Konva 标注并存）。
- 框选必须可用；清晰度在 **Konva 路径内** 用 DPR 对齐解决，而不是靠透明 Stage + DOM 底图。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-17 | 首次记录：亚像素再采样导致发糊；HTML backdrop 导致 Windows 透明窗无法框选；定案为 Konva 底图 + `natural/dpr` + 关闭平滑。 |
