# billing · 订阅与计费

订阅、配额与账单：套餐状态机、额度扣减、模型价目与支付订单对账。

## 数据所有权

| 表 | 说明 |
| --- | --- |
| `subscription` | 租户订阅（套餐、周期、配额）。 |
| `payment_order` | 支付订单与账单状态。 |
| `billing_price` | 模型价目（分 / 百万 token），按 `(租户, 型号)` 与生效窗口维护。 |

`billing_price` 的 RLS 策略恒假：它是**平台面**目录表，只允许平台连接读写（同 `gateway_model`），
租户连接既读不到也写不了，因此不会出现「租户自带价目」把账单口径带偏。

## 对外接口

三块纯函数，都不碰数据库：

- **折算**：[`amount_cents`] —— `round_half_up((输入 token × 输入单价 + 输出 token × 输出单价) / 1_000_000)`，
  全程整数（i128 中间量），只在最后四舍五入一次。舍入点是**分组**（租户 × 型号 × 价目），
  所以任何一行账单都能用「token × 单价」独立复算。
- **价目窗口**：[`Window`] 表示 `[effectiveFrom, effectiveTo)`，右端空 = 无限期；
  [`PriceDraft`] 负责「单价非负 / 币种形状 / 同租户同型号区间不重叠」的校验。
  改价 = 先给旧窗口补结束时间，再开新窗口；中间留下的空隙会被对账报成「未定价」而不是静默沿旧价。
- **对账**：[`reconcile`] 把「用量折算金额」与「订单实收」放到一起，输出每租户合计、每型号明细
  与异常清单（`UNPRICED_USAGE` / `CURRENCY_MISMATCH` / `USAGE_WITHOUT_ORDER` /
  `ORDER_WITHOUT_USAGE` / `PAID_NOT_ACTIVATED` / `REMARKED`）。

取价（哪条价目在用量发生时刻生效）没有在本 crate 里再实现一遍：它发生在 service 层那条聚合 SQL 的
JOIN 条件里（`modelID` 相等 + `createdAt` 落在窗口内 + 租户专属价优先）。理由是「时间区间取价」无法在
一次 SQL 之外用纯 Rust 等价重放，重复实现只会让两套口径漂移；本 crate 通过 [`Window::contains`] /
[`Window::overlaps`] 保证写入侧与查询侧用同一套区间语义。

## 边界约束

- 不依赖 HTTP 框架；不依赖 `cogito`（R1）。
- 金额一律使用最小货币单位的整数，禁止浮点。
- 不 JOIN 其他 crate 的表：需要身份或用量信息时，通过调用方传入的参数或 `audit` 事件获得。
- 权限判断调用 `authz`（R3）。
- 对账口径的两条不变式，改动时必须仍然成立：
  `usage_amount + mismatched_amount == Σ 型号明细金额`、`全局合计 == Σ 每租户合计`。

## 迁移状态

- 已迁入（P7e）：`billing_price` 价目表、金额折算与用量/订单对账（迁移 + entity + 平台面端点）。
- 待迁入（P3b）：来源为 `service/src/services/{subscription,payment}`（含渠道 testdata）；迁完后删除。
