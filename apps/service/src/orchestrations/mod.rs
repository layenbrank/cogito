//! 工作流（可靠执行一侧的装配点）：把编排与活动注册成处理器。
//!
//! 只有 `orchestrator` 二进制会调用这里的 [`registrations`]；api 与 worker 二进制不注册
//! 任何处理器（它们只负责起实例、做业务读写）。所以本模块是「长任务目录」：一个工作流
//! 一个文件，配上它自己的活动。
//!
//! 两条铁律（见 crates/durable/README.md 的「语义」）：
//! - **编排必须确定性**：只能读输入、调活动、用框架给的时钟/随机源。编排里不能直接
//!   `reqwest`、不能读系统时间、不能遍历 `HashMap`——进程重启后会重放同一段代码，
//!   任何一次结果不同都会让历史对不上。
//! - **活动必须幂等**：活动是「至少一次」执行（崩溃、锁过期、超时都会重跑），副作用要用
//!   幂等键收敛。惯例是把 `ctx.instance_id()`（= 编排实例 id）传给下游当幂等键。
//!
//! 名字是持久化契约：改名字等于换了工作流，线上正在跑的实例会找不到实现。名字以
//! `常量 + 注册` 的形式就近定义，别在多处写字面量。
//!
//! 注册表不在这里构建：[`durable::Runtime::start`] 会构建它，重名 / 保留名字之类的注册
//! 错误因此在启动时报出来，而不是静默丢处理器。
//!
//! 迁移状态：P4c 搭好装配骨架；P4d 加入第一条真实工作流 RAG 索引
//! （`rag.index-asset`，见 [`rag`]），它同时是「长任务长什么样」的样板；
//! P9c 加入服务端 agent 的多轮循环（`agent.run`，见 [`agent`]）——它是第一条
//! 「循环次数不固定、由上游模型的输出决定分支」的编排，与 RAG 那种固定阶段的形状不同。

pub mod agent;
pub mod rag;
pub mod retry;

use std::sync::Arc;

use durable::{Activities, Orchestrations};

use crate::clients::compute::ComputeClient;

/// `orchestrator` 启动时注册的处理器集合。
#[derive(Debug)]
pub struct Registrations {
    pub activities: Activities,
    pub orchestrations: Orchestrations,
}

/// 装配全部编排与活动。
///
/// 只被 `orchestrator` 二进制调用：它必须手里有出站客户端（长任务的每一步都要出站），
/// 以及一批会影响历史的参数（嵌入批大小、模型）——这些参数在装卸时一次性注入，
/// 保证同一个运行时里的实例看到的是同一套值。
pub fn registrations(
    compute: Arc<ComputeClient>,
    embed_batch_size: usize,
    embed_model: String,
) -> Registrations {
    let activities = rag::register_activities(Activities::builder(), Arc::clone(&compute));
    let activities = agent::register_activities(activities, compute);

    let orchestrations =
        rag::register_orchestration(Orchestrations::builder(), embed_batch_size, embed_model);
    let orchestrations = agent::register_orchestration(orchestrations);

    Registrations {
        activities,
        orchestrations,
    }
}
