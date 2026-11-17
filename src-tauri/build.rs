fn main() {
    // the ONNX models in dictation, everywhere but an Intel Mac (Cargo.toml, transcribe-rs)
    println!("cargo::rustc-check-cfg=cfg(onnx)");
    if std::env::var("TARGET").unwrap() != "x86_64-apple-darwin" {
        println!("cargo::rustc-cfg=onnx");
    }
    tauri_build::build()
}
