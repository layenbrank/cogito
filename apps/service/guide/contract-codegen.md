# 契约代码生成

`apps/service/spec/openapi.json` 是对外契约的**唯一真源**；各语言客户端/类型一律由它派生，不手写、不复制。

```
utoipa 标注 ──cargo run --bin docs──▶ spec/openapi.json ──生成器──▶ 各语言产物
                                            │
                              漂移门禁（CI 字节比对）
```

真源本身也受门禁守护：`cargo run --bin docs` 必须与提交的 `spec/` 逐字节一致，否则 CI 失败。
所以「改契约」的正确顺序永远是：改 `utoipa` 标注 → 重新生成 spec → 重新生成语言产物 → 一起提交。

## 生成器与版本锁定

| 目标 | 工具 | 版本锁位置 |
|------|------|-----------|
| TypeScript | `openapi-typescript` | `apps/service/package.json` + `pnpm-lock.yaml` |
| Python | `openapi-python-client` | `scripts/contracts.ts` 中的 `PY_CLIENT` 常量 |
| Rust | `openapi-generator`（`rust` generator） | `apps/service/openapitools.json`（jar 版本） |

三个生成器同时是 spec 的**第三方独立校验器**：任一对我们的 spec 报错，都说明契约本身有问题，
而不是生成器口味问题（例：OpenAPI 3.1 要求 `info.license.identifier`，缺失会被 `openapi-generator` 直接拒绝）。

## 产物归属：什么进仓库

| 产物 | 路径 | 是否提交 | 原因 |
|------|------|---------|------|
| TypeScript | `packages/types/src/openapi.d.ts` | ✅ | 已有消费者；由 CI 漂移门禁守护 |
| Python | `apps/service/.generated/python/` | ❌ | 暂无消费者；按需生成，避免把上兆字节的 vendored 客户端塞进仓库 |
| Rust | `apps/service/.generated/rust/` | ❌ | 同上，且 Rust 侧应直接复用服务端类型而非生成客户端 |

消费者出现时，把对应产物移到正式包路径、纳入 CI 门禁即可——这是**显式决策点**，届时在本文更新表格。

## 用法

```bash
cd apps/service

pnpm contracts            # 生成全部产物
pnpm contracts:ts         # 只生成 TypeScript 类型（提交的那份）
pnpm contracts --check    # 漂移检查：只写 .generated/，绝不改仓库文件（CI 用）
pnpm contracts python     # 单独生成 Python 客户端
```

前置条件：`uvx`（Python）、JRE 11+（Rust 生成器）；TypeScript 与 Rust 生成器本体来自 `pnpm install`。

## 约束

- **不要格式化生成物**：`packages/types/src/openapi.d.ts` 已加入 `.prettierignore`，其内容必须与生成器输出逐字节一致；`.gitattributes` 固定它以 LF 入库。
- **不要手改生成物**：改契约就改 `utoipa` 标注，再重新生成。
- 生成的 Rust crate 会被脚本补上 `[workspace]` 表——它落在 `apps/service` 子树内，不这样声明会被 cargo 误判为父 workspace 成员。
- 漂移检查在 Windows（CRLF 工作区）与 Linux CI 下结果一致：比对前统一行尾。
