//! 壳层权限面（S1 / S6）。`capabilities` 的静态 scope 是下限，运行期真正说了
//! 算的是这里放行的目录 / 文件（见 `docs/decisions/security-boundary.md`）；
//! `audit` 是 Agent 本地工具调用的可查账（导出给诊断页，只导出不查询）。
//! `cost` 是「这一轮花了多少钱」的账本（同样只导出不查询；未知模型记「未计价」）。
pub mod audit;
pub mod cost;
pub mod grants;
