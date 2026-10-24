# 依赖与工具链说明

面向刚接触 React Native / Expo 的开发者：先理解「工具链长什么样」，再查「每个包是干什么的」。

对应文件：根目录 [`package.json`](../package.json)。

---

## 1. 先建立心智模型

React Native 应用可以粗分成几层：

```text
你写的 TS/TSX（app/、components/、stores/ …）
        ↓
React + React Native（UI 与跨端原语）
        ↓
Expo SDK / 第三方原生模块（通知、存储、文件系统 …）
        ↓
Metro 打包 JS  →  Development Build / 商店包（原生壳）
```

| 概念 | 作用 |
|------|------|
| **Metro** | RN 的 JS 打包器（类似 Web 的 Vite/Webpack）。`bun run dev` 就是起 Metro。 |
| **Expo** | 在 RN 之上的工具链与模块集合，统一版本、简化原生配置与构建。 |
| **Expo Go** | Expo 官方预装壳，只能跑官方内置模块。本项目**不推荐**长期使用。 |
| **Development Build** | 带你自己原生依赖的「私有 Expo Go」，由 `expo-dev-client` + EAS 打出。 |
| **EAS** | Expo 云端构建 / 提交 / 热更新服务（`eas build` / `submit` / `update`）。 |
| **dependencies** | 运行时依赖，打进 App。 |
| **devDependencies** | 只在开发、测试、格式化时用，一般不进用户安装包的业务逻辑。 |

安装依赖请优先用 Expo 对齐版本：

```bash
npx expo install <包名>
```

不要随手 `bun add` 一个与 SDK 54 不匹配的 React Native 生态包。

---

## 2. 核心运行时（必须认识）

| 包 | 作用 |
|----|------|
| `react` | UI 库本体（组件、Hooks）。 |
| `react-native` | 跨端原生组件与 API（`View`、`Text`、`TextInput` 等）。本项目锁定 **0.81**（随 Expo 54）。 |
| `react-dom` / `react-native-web` | 让同一套组件能在 Web 上跑（`bun run web`）。 |
| `expo` | Expo 核心；管理 SDK、配置、CLI 集成。 |

---

## 3. 路由与导航

| 包 | 作用 |
|----|------|
| `expo-router` | **基于文件的路由**（`app/` 目录即路由表）。入口在 `package.json` 的 `"main": "expo-router/entry"`。 |
| `@react-navigation/native` | React Navigation 核心，expo-router 底层会用到。 |
| `@react-navigation/native-stack` | 原生堆栈导航（推入/弹出页面）。 |
| `@react-navigation/elements` | 导航相关 UI 零件（按钮、标题等）。 |
| `expo-linking` | Deep Link / URL 与路由打通。 |
| `react-native-screens` | 原生屏幕容器，提升导航性能与转场。 |
| `react-native-safe-area-context` | 刘海、底部横条等安全区 insets。 |

上手建议：先看 `app/` 目录结构，再读 [expo-router 文档](https://docs.expo.dev/router/introduction/)。

---

## 4. Expo 官方模块（能力型）

| 包 | 作用 |
|----|------|
| `expo-dev-client` | Development Build 客户端，替代 Expo Go。 |
| `expo-constants` | 读取 `app.json` / 构建常量（版本、环境等）。 |
| `expo-crypto` | 哈希、随机数（本项目用于密码加盐哈希）。 |
| `expo-font` | 加载自定义字体。 |
| `expo-splash-screen` | 启动闪屏控制。 |
| `expo-status-bar` | 状态栏样式。 |
| `expo-localization` | 系统语言 / 区域。 |
| `expo-notifications` | 本地 / 推送通知与权限。 |
| `expo-document-picker` | 选文件（导入备份）。 |
| `expo-file-system` | 读写本地文件。 |
| `expo-sharing` | 系统分享面板（导出备份）。 |
| `expo-web-browser` | 应用内打开网页。 |
| `@expo/vector-icons` | Expo 内置图标集（如 FontAwesome）。 |

这些多数可在 [Expo SDK 54 文档](https://docs.expo.dev/versions/v54.0.0/) 按包名查阅。

---

## 5. UI 与样式

| 包 | 作用 |
|----|------|
| `nativewind` | 在 RN 里用 **Tailwind 风格 className** 写样式。 |
| `react-native-css-interop` | NativeWind 4 的 CSS 互操作层。 |
| `tailwindcss`（dev） | Tailwind 引擎与配置（开发期）。 |
| `lucide-react-native` | Lucide 图标（需 `react-native-svg`）。 |
| `react-native-svg` | SVG 渲染，图标库依赖它。 |
| `@gluestack-ui/themed` | Gluestack 组件库（主题化 UI）。 |
| `@gluestack-ui/config` | Gluestack 默认主题配置。 |
| `@gluestack-ui/nativewind-utils` | Gluestack 与 NativeWind 的工具函数。 |

> 说明：当前界面大量是自建 `components/ui/*` + NativeWind；Gluestack 可能是历史依赖，读代码时以实际 import 为准。

---

## 6. 状态、表单与数据校验

| 包 | 作用 |
|----|------|
| `zustand` | 轻量全局状态（登录态、设置、磁贴、Agent）。 |
| `@tanstack/react-query` | 服务端/异步数据缓存与请求状态（Provider 已挂在根布局）。 |
| `react-hook-form` | 表单状态与校验触发（登录 / 注册）。 |
| `@hookform/resolvers` | 把 Zod schema 接到 react-hook-form。 |
| `zod` | 运行时 schema 校验与类型推导。 |

典型链路：`zod` 定义规则 → `@hookform/resolvers` → `react-hook-form` → 提交进 `zustand` / API。

---

## 7. 存储、动画与其它原生能力

| 包 | 作用 |
|----|------|
| `react-native-mmkv` | 高性能本地键值存储（设置、会话、磁贴镜像）。 |
| `react-native-nitro-modules` | MMKV v4 依赖的原生桥接运行时（**需 Development Build**）。 |
| `@react-native-community/datetimepicker` | 系统日期时间选择器（提醒 / 截止日期）。 |
| `react-native-reanimated` | 高性能动画（UI 线程）。 |
| `react-native-worklets` | Reanimated 4 相关的 worklet 运行时。 |
| `i18next` / `react-i18next` | 多语言文案（见 `i18n/`）。 |
| `pod-install` | iOS 侧 CocoaPods 安装辅助（Mac 上有用）。 |

---

## 8. 开发依赖（devDependencies）

| 包 | 作用 |
|----|------|
| `typescript` | 静态类型检查（`bun run typecheck`）。 |
| `@types/react` / `@types/jest` | TS 类型定义。 |
| `@babel/core` | JS/TS 转译核心（Metro / Jest 会用到）。 |
| `eslint` | 代码规范检查。 |
| `eslint-config-expo` | Expo 官方 ESLint 规则集。 |
| `eslint-config-prettier` | 关闭与 Prettier 冲突的 ESLint 规则。 |
| `prettier` | 代码格式化。 |
| `prettier-plugin-tailwindcss` | 自动排序 Tailwind class。 |
| `jest` | 单元测试运行器。 |
| `jest-expo` | Jest 的 Expo/RN 预设。 |
| `@testing-library/react-native` | 按用户行为测试组件。 |

---

## 9. `package.json` scripts 与工具链的关系

| 脚本 | 背后工具 |
|------|----------|
| `dev` / `android` / `ios` / `web` | Expo CLI + Metro |
| `prebuild` | 根据 `app.json` 生成 `android/` / `ios/` 原生工程 |
| `build:*` / `prod*` | **EAS Build** 云端打安装包 |
| `submit:*` | **EAS Submit** 提交商店 |
| `update:prod` | **EAS Update** OTA 下发 JS |
| `typecheck` | TypeScript |
| `test*` | Jest |
| `lint` / `format` | ESLint + Prettier |

更完整的真机 / 发布流程见 [getting-started.md](./getting-started.md)。

---

## 10. 建议的阅读顺序（新手）

1. **本页**：知道依赖分哪些类、各解决什么问题。  
2. [getting-started.md](./getting-started.md)：装环境、Development Build、打包发布。  
3. 打开 `app/_layout.tsx` 与 `app/(navigation)/`：看路由与 Tab 如何组装。  
4. 打开 `stores/` + `api/`：看状态与本地 mock API。  
5. 打开 `components/ui/`：看 UI 约定与 NativeWind 用法。  
6. 按需深入：Zustand、Zod、expo-router、MMKV、Notifications 官方文档。

---

## 11. 快速对照：改需求时先动谁

| 你想做… | 优先看 |
|---------|--------|
| 加一个新页面 | `app/` + `expo-router` |
| 改主题色 / 间距 | `constants/Colors.ts`、`components/ui`、NativeWind class |
| 改文案 / 中英文 | `i18n/index.ts` |
| 持久化用户数据 | `stores/storage.ts`、`react-native-mmkv` |
| 登录注册校验 | `zod` + `react-hook-form` + `api/auth.ts` |
| 本地提醒 | `services/notifications.ts` + `expo-notifications` |
| 导入导出备份 | `expo-document-picker` / `expo-sharing` / `expo-file-system` |
| 打安装包 / 上架 | EAS 脚本（见 README） |
