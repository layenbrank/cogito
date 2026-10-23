use dialoguer::{Select, theme::ColorfulTheme};
use cogito::utils::generate;

fn main() {
    println!("=== 生成 Auth 系统所需的密钥 ===\n");

    let options = vec![
        "生成 JWT_SECRET",
        "生成 AES_KEY",
        "生成 CVID",
        "生成所有密钥",
    ];

    let selection = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("请选择要生成的密钥类型")
        .items(&options)
        .default(0)
        .interact()
        .unwrap();

    match selection {
        0 => {
            let jwt_secret = generate::generate_jwt_secret();
            println!("\n✅ JWT_SECRET 生成成功：");
            println!("JWT_SECRET={}", jwt_secret);
            println!("\n💡 使用说明：");
            println!("   - 用于 JWT token 的签名和验证");
            println!("   - 写入 config.local.yaml 的 security.jwt_secret");
        }
        1 => {
            let aes_key = generate::generate_aes_key();
            println!("\n✅ AES_KEY 生成成功：");
            println!("AES_KEY={}", aes_key);
            println!("\n💡 使用说明：");
            println!("   - 仅在使用 AES 加密方式时需要");
            println!("   - 写入 config.local.yaml 的 security.jwt_secret");
        }
        2 => {
            let cvid = generate::generate_secure_cvid();
            println!("\n✅ CVID 生成成功：");
            println!("CVID={}", cvid);
            println!("\n💡 使用说明：");
            println!("   - 加密随机数，符合 GUID v4 标准");
            println!("   - 可用于客户端标识符等场景");
        }
        3 => {
            let jwt_secret = generate::generate_jwt_secret();
            let aes_key = generate::generate_aes_key();
            let cvid = generate::generate_secure_cvid();

            println!("\n✅ 所有密钥生成成功：\n");
            println!("JWT_SECRET={}", jwt_secret);
            println!("AES_KEY={}", aes_key);
            println!("CVID={}", cvid);

            println!("\n=== 使用说明 ===");
            println!("1. 将上述密钥写入 config.local.yaml（security 段）");
            println!("2. JWT_SECRET: 用于 JWT token 的签名和验证");
            println!("3. AES_KEY: 仅在使用 AES 加密方式时需要");
            println!("4. CVID: 加密随机数，符合 GUID v4 标准");
            println!("5. 建议在生产环境中使用更安全的密钥管理方式");
        }
        _ => unreachable!(),
    }
}
