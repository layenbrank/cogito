# 外部集成（出站）

Rust 服务对外的 HTTP 出站只有三处，都归在 `src/clients/`：

- **进程内直连**：云厂商 API（阿里云短信 / 邮件 / OSS）——签名与协议在能力 crate `crates/aliyun`，
  策略层在 [`src/clients/aliyun.rs`](../src/clients/aliyun.rs)。
- **容器侧车**：go-captcha 行为验证码——第三方镜像 `wenlng/go-captcha-service`，客户端
  [`src/clients/gocaptcha.rs`](../src/clients/gocaptcha.rs)。
- **同集群独立进程**：Python compute（AI 计算车间）——契约在 [`spec/internal.yaml`](../spec/internal.yaml)，
  客户端 [`src/clients/compute.rs`](../src/clients/compute.rs)。它是**叶子**：不直连业务表、
  不持长期云凭据，要模型算力或资产正文时回打 cogito 的服务身份面
  （见 [gateway README](../src/services/gateway/README.md#服务身份apiv1service)）。资产正文**只经服务身份内容端点**
  `GET /api/v1/service/assets/{id}/content` 取字节：对象存储 / CAS 分片布局是 cogito 的实现细节，
  所以出站请求里没有 `objectKey` 这类存储键，换桶换路径不影响它。

历史上有过一个自研 Go 侧车 `aliyun-gateway`（HTTP 信封 + `X-API-Key` 转发短信）。它只覆盖了
短信一条链路（邮件/OSS 是 501 占位），却把「一个云厂商 = 一个容器」的成本固定下来。现在阿里云
出站是**进程内**的：少一跳网络、少一份配置、少一个登录态，且能在本地用 HTTP 桩做契约测试
（`cargo test --test aliyun`）。

## 分层

| 层 | 目录 | 职责 |
|----|------|------|
| 业务 | `src/services/` | OTP、上传等业务逻辑 |
| 策略 | `src/clients/` | 把配置翻译成能力 crate 的调用；不写签名、不拼协议 |
| 协议 | `crates/<capability>/` | 单个外部系统的协议实现（签名、请求形状、错误分类）|
| 第三方侧车 | `docker/<name>/` | 自研 Go 已无；仅剩第三方镜像的挂载配置 |
| 应用配置 | `config.yaml` | 端点、模板、超时；凭据只放 `config.local.yaml` |

## 规则

1. **禁止**在 `services/` 中直接使用 `reqwest` 调外部 API——出站只能经过 `src/clients/*`
2. **禁止**在 `src/clients/*` 里写签名/协议细节——那是能力 crate 的活
3. 新增一个云厂商先问「能不能进程内直连」：只有**必须独立进程**（如第三方的 Go 镜像）才加容器
4. 凭据只出现在 `config.yaml` / `config.local.yaml`（后者不进版本库），不写进代码或测试
5. **模型出网只有一个出口**：compute 的嵌入必须回打 cogito 的 `/api/v1/service/**`，不许自己连厂商——
   否则配额与用量会分裂成两份账，`gateway.*` 的档位配置也就管不住它了
6. **正文入站也只有一个出口**：compute 读资产字节必须走服务身份内容端点（拿 `scope=asset-read` 令牌），
   出站请求里不带对象存储键——换存储布局不该牵动叶子服务
7. **写 cogito 业务数据同样只有一个出口**：叶子服务不许持长期凭据，所以「改资产可见性」这种写走
   **拿审批行换写令牌**（`scope=asset-write`），写端点**不带请求体**——要写的参数在签令牌时就按审批原文
   定稿了，见 [`docs/decisions/approval-channel.md`](../../../docs/decisions/approval-channel.md#5-第二种落地拿审批换写令牌p10b)
8. 新增集成时同步更新本文件与 [`guide/configuration.md`](configuration.md)

## 侧车契约（仅 go-captcha）

- `GET /healthz` — compose healthcheck
- `X-API-Key` — Rust ↔ 侧车鉴权（两侧配置一致）
- 响应信封 `{ "code": 0, "message": "ok", "data": ... }`

## 当前集成

| 系统 | 形态 | 客户端 | 配置 |
|------|------|--------|------|
| 阿里云短信 / 邮件 / OSS | 进程内（`crates/aliyun`） | [`clients/aliyun.rs`](../src/clients/aliyun.rs) | `aliyun.*` |
| compute（Python 计算车间） | 同集群独立进程 :8081（如 `http://compute:8081`） | [`clients/compute.rs`](../src/clients/compute.rs) | `compute.*`（+ 反向出站面 `/api/v1/service/token`、`/embeddings`、`/assets/{id}/content`、`/assets/{id}/visibility`） |
| go-captcha | 容器 `gocaptcha` :8080（第三方镜像） | [`clients/gocaptcha.rs`](../src/clients/gocaptcha.rs) | `auth.captcha.*` + [`docker/gocaptcha/`](../../../docker/gocaptcha/) |

## 新增能力 crate 的检查清单

出站协议一律按能力 crate 走（门禁规则见 [`scripts/capabilities.ts`](../scripts/capabilities.ts)）：

- [ ] `crates/<name>/` + `src/lib.rs` + `README.md`（含 `## 数据所有权`、`## 对外接口`）
- [ ] 在根 [`Cargo.toml`](../Cargo.toml) 的 `[workspace] members` 与 `[workspace.dependencies]` 登记
- [ ] 不依赖 `cogito` / web 框架 / 其他能力 crate（门禁 R1）
- [ ] `scripts/capabilities.ts` 加条目（`publicModules`、`absorbs`）
- [ ] `src/clients/<name>.rs` 策略层 + `configures` 配置结构（含 `validate_*`）
- [ ] 契约测试（本地 HTTP 桩，见 [`tests/support/mod.rs`](../tests/support/mod.rs)）+ [`guide/configuration.md`](configuration.md)
