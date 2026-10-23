# gateway · 模型网关

对外部模型服务的**唯一出网点**：路由、降级、流式透传、按调用计量。

## 数据所有权

| 表 | 说明 |
| --- | --- |
| `gateway_provider` | 供应商配置与凭证（含平台级全局行）。 |
| `gateway_model` | 模型目录 / 路由与定价。 |
| `gateway_usage` | 每次调用的用量明细（**唯一计量点**）。 |
| `gateway_audit` | 网关侧的调用与配置变更审计。 |

## 对外接口

- `LlmGateway` 端口：以「请求 → 流式响应」为契约，上层（api / worker）只依赖端口。
- 路由与降级：按模型与租户策略选择供应商，失败转移记录在用量与审计中。
- 计量：一次调用写一行 `gateway_usage`（含 token 数、成本、耗时），计费只读这里。

## 边界约束

- 所有出站模型调用必须经过本 crate；其他 crate 不得自行请求模型供应商。
- 凭证只在本 crate 解密使用，不出 crate、不进日志。
- 不依赖 HTTP 框架（HTTP 客户端的选型属于实现细节，端口对外保持框架无关）。
- 不 JOIN 其他 crate 的表；权限判断调用 `authz`（R3）。

## 迁移状态

- 待迁入（P3b）：来源为 `service/src/services/gateway` 与 `service/src/clients/*`；迁完后删除。
