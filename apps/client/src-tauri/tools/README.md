# 构建工具

## protoc（LanceDB）

`lancedb` → `lance-encoding` 编译需要 `protoc`。`.cargo/config.toml` 默认指向：

```text
tools/protoc/bin/protoc.exe
```

本目录下的 `protoc/` 已 gitignore。缺失时（Windows 示例）：

```powershell
$dir = "$PSScriptRoot/protoc"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
curl.exe -L -o "$dir/protoc.zip" "https://github.com/protocolbuffers/protobuf/releases/download/v29.3/protoc-29.3-win64.zip"
Expand-Archive "$dir/protoc.zip" -DestinationPath $dir -Force
Remove-Item "$dir/protoc.zip"
& "$dir/bin/protoc.exe" --version
```

也可设置环境变量 `PROTOC` 覆盖。
