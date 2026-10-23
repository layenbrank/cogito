use actix_web::{HttpRequest, Responder, web};

use crate::{
    filters::exception::Exception,
    interceptors::envelope::Envelope,
    services::engine::{schema::QueryP, service::EngineService},
    utils::code::request,
};

pub struct EngineController;

impl EngineController {
    pub async fn toRead(req: HttpRequest) -> impl Responder {
        // 手动提取查询参数，以便更好地处理错误
        let params = match web::Query::<QueryP>::from_query(req.query_string()) {
            Ok(query) => {
                let params = query.into_inner();
                tracing::debug!(%params, "QueryP");
                params
            }
            Err(err) => {
                tracing::warn!(error = %err, "engine query parse failed");
                return Exception::custom(request::INVALID_PARAMETER_FORMAT, "请求参数格式错误")
                    .transform();
            }
        };

        // 直接传递 HttpRequest 给 service，统一在 controller 处理错误
        match EngineService::suggestion(params, &req).await {
            Ok(suggestion) => Envelope::success(suggestion, "获取搜索建议成功").transform(),
            Err(err) => {
                // 使用 From trait 自动转换错误
                Exception::from(err).transform()
            }
        }
    }
}
