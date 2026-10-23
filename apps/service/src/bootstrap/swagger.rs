use actix_web::{HttpResponse, Responder, get, http::header};

/// `/swagger-ui` → `/swagger-ui/`（utoipa 路由需尾斜杠）
#[get("/swagger-ui")]
pub async fn redirect_to_ui() -> impl Responder {
    HttpResponse::PermanentRedirect()
        .append_header((header::LOCATION, "/swagger-ui/"))
        .finish()
}
