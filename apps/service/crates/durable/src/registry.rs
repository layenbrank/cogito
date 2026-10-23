use duroxide::runtime::OrchestrationRegistry;
use duroxide::runtime::registry::{ActivityRegistry, ActivityRegistryBuilder};
use duroxide::{ActivityContext, OrchestrationContext, OrchestrationRegistryBuilder};

use crate::DurableError;

/// 编排注册表：把工作流函数挂到名字上，起实例时按名字查。
///
/// 编排函数只应该写「按什么顺序做什么」，每一步的返回值由框架持久化：进程重启后
/// 同一段代码会被重放，已经完成的步骤直接复用历史结果，不会重复执行。
pub struct Orchestrations {
    inner: OrchestrationRegistryBuilder,
    names: Vec<String>,
    errors: Vec<String>,
}

impl Orchestrations {
    pub fn builder() -> Self {
        Self {
            inner: OrchestrationRegistry::builder(),
            names: Vec::new(),
            errors: Vec::new(),
        }
    }

    /// 注册一个编排。名字是持久化契约的一部分（改了名字等于换了工作流）。
    ///
    /// 重复注册同名编排会记下来，并在 [`crate::Runtime::start`] 时报错退出——
    /// 静默覆盖会让线上跑着的工作流换掉语义。
    pub fn register<F, Fut>(mut self, name: impl Into<String>, handler: F) -> Self
    where
        F: Fn(OrchestrationContext, String) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<String, String>> + Send + 'static,
    {
        let name = name.into();
        if self.names.contains(&name) {
            self.errors.push(format!("重复注册编排: {name}"));
            return self;
        }
        self.names.push(name.clone());
        self.inner = self.inner.register(name, handler);
        self
    }

    /// 已注册的编排名（启动日志与自检用）。
    pub fn names(&self) -> &[String] {
        &self.names
    }

    pub(crate) fn build(self) -> Result<OrchestrationRegistry, DurableError> {
        let Self { inner, errors, .. } = self;
        if !errors.is_empty() {
            return Err(DurableError::Registration {
                kind: "编排",
                message: errors.join("; "),
            });
        }
        inner
            .build_result()
            .map_err(|message| DurableError::Registration {
                kind: "编排",
                message,
            })
    }
}

impl std::fmt::Debug for Orchestrations {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Orchestrations")
            .field("names", &self.names)
            .field("errors", &self.errors)
            .finish()
    }
}

/// 活动注册表：真正产生副作用（HTTP、对象存储、写库）的步骤。
///
/// 活动可能被**至少执行一次**：崩溃、超时、锁过期都会导致重跑，所以每个活动都必须
/// 用能拿到的上下文做幂等（惯例是用 `ctx.instance_id()` 当幂等键）。
pub struct Activities {
    inner: ActivityRegistryBuilder,
    names: Vec<String>,
    errors: Vec<String>,
}

impl Activities {
    pub fn builder() -> Self {
        Self {
            inner: ActivityRegistry::builder(),
            names: Vec::new(),
            errors: Vec::new(),
        }
    }

    /// 注册一个活动；同一个名字只允许注册一次（理由同编排）。
    pub fn register<F, Fut>(mut self, name: impl Into<String>, handler: F) -> Self
    where
        F: Fn(ActivityContext, String) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<String, String>> + Send + 'static,
    {
        let name = name.into();
        if self.names.contains(&name) {
            self.errors.push(format!("重复注册活动: {name}"));
            return self;
        }
        self.names.push(name.clone());
        self.inner = self.inner.register(name, handler);
        self
    }

    /// 已注册的活动名（启动日志与自检用）。
    pub fn names(&self) -> &[String] {
        &self.names
    }

    pub(crate) fn build(self) -> Result<ActivityRegistry, DurableError> {
        let Self { inner, errors, .. } = self;
        if !errors.is_empty() {
            return Err(DurableError::Registration {
                kind: "活动",
                message: errors.join("; "),
            });
        }
        inner
            .build_result()
            .map_err(|message| DurableError::Registration {
                kind: "活动",
                message,
            })
    }
}

impl std::fmt::Debug for Activities {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Activities")
            .field("names", &self.names)
            .field("errors", &self.errors)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_orchestration_registration_is_reported() {
        let orchestrations = Orchestrations::builder()
            .register("Once", |_ctx, input: String| async move { Ok(input) })
            .register("Once", |_ctx, input: String| async move { Ok(input) });

        assert_eq!(orchestrations.names(), ["Once"]);
        assert!(orchestrations.build().is_err());
    }

    #[test]
    fn duplicate_activity_registration_is_reported() {
        let activities = Activities::builder()
            .register("Step", |_ctx, input: String| async move { Ok(input) })
            .register("Step", |_ctx, input: String| async move { Ok(input) });

        assert_eq!(activities.names(), ["Step"]);
        assert!(activities.build().is_err());
    }

    #[test]
    fn reserved_activity_prefix_is_reported() {
        // 保留前缀由实现本体判断；我们把它的报错原样带出来，而不是静默丢弃这个活动。
        let activities = Activities::builder().register(
            "__duroxide_syscall:ping",
            |_ctx, input: String| async move { Ok(input) },
        );

        assert!(activities.build().is_err());
    }

    #[test]
    fn distinct_names_build() {
        let activities = Activities::builder()
            .register("Step", |_ctx, input: String| async move { Ok(input) })
            .register("Other", |_ctx, input: String| async move { Ok(input) });

        let built = activities.build().expect("不重名应当能构建");
        assert_eq!(built.count(), 2);
        assert!(built.has("Step"));
    }
}
