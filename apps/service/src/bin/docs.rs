use std::{fs, path::Path};

use cogito::oas::json_pretty;

fn main() -> anyhow::Result<()> {
    let json = json_pretty();
    let out_path = Path::new("spec/openapi.json");

    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(out_path, json)?;
    println!("OpenAPI spec written to {}", out_path.display());
    Ok(())
}
