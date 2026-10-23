use actix_web::web;

use crate::guards::auth::Auth;
use crate::middlewares::rate_limit::AuthGovernor;
use crate::services::auth::controller::AuthController;

pub struct AuthModule;

macro_rules! auth_routes {
    ($scope:expr) => {
        $scope
            .route("/captcha", web::post().to(AuthController::captcha))
            .route("/otp", web::post().to(AuthController::otp))
            .route("/signin", web::post().to(AuthController::signin))
            .route(
                "/signin/phone",
                web::post().to(AuthController::signin_phone),
            )
            .route(
                "/signin/email",
                web::post().to(AuthController::signin_email),
            )
            .route("/signup", web::post().to(AuthController::signup))
            .route(
                "/password/forgot",
                web::post().to(AuthController::forgot_password),
            )
            .route(
                "/password/reset",
                web::post().to(AuthController::reset_password),
            )
            .service(
                web::scope("")
                    .wrap(Auth::isRequired())
                    .route("/profile", web::get().to(AuthController::toRead))
                    .route("/profile", web::put().to(AuthController::toUpdate))
                    .route("/password", web::put().to(AuthController::password))
                    .route("/signout", web::post().to(AuthController::signout)),
            )
    };
}

impl AuthModule {
    pub fn configure(cfg: &mut web::ServiceConfig, auth_governor: &AuthGovernor) {
        if auth_governor.0.is_some() {
            cfg.service(auth_routes!(
                web::scope("/auth").wrap(auth_governor.clone())
            ));
        } else {
            cfg.service(auth_routes!(web::scope("/auth")));
        }
    }
}
