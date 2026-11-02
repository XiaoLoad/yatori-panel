# 上游瘦身提案：yatori-go-core 的 embed 资产与按驱动拆分

> 状态：调研完成，待发 PR。所有数字为实测（yatori-go-core@4a7958d63f5c、
> ddddocr-go@1896343369f8、Go 1.27.3 windows/amd64）。

## 问题

yatori-panel 的 Go 网关（只用到英华/学习通）`go build -trimpath -ldflags "-s -w"`
产物 **226.1 MB**。分解：

| 嵌入内容 | 位置 | 大小 | 英华网关是否需要 |
|---|---|---|---|
| tencentCollect.exe + tencentPowSolve.exe | `utils/YatoriCoreInit.go`（无构建约束） | **139.0 MB** | ❌ 仅 ICVE（智慧职教）的 TencentPass 使用 |
| ddddocr 三架构 DLL（win x64+x86+arm64） | `ddddocr-go/utils/ocr_lib_windows.go` | ~36 MB（其中 22.5 MB 死重） | ⚠️ 只需当前 GOARCH 一架构 |
| 3× ONNX 模型（每个都嵌） | 同上 + Init.go | ~35 MB | ⚠️ 半死重：英华仅用 common_tencent 路径 |
| node_modules/jsdom 等 | YatoriCoreInit.go | ~6.6 MB | ✅（goja 验证码 JS） |
| 代码与符号 | — | ~9 MB | ✅ |

注：跨平台运行库（darwin/linux/android）已被 `//go:build` 正确排除，
Windows 构建不含（已用特征串扫描二进制证实）。

## 建议方案（按收益/侵入性排序）

### 1. 大杀器：把腾讯求解器 exe 拆到构建标签后（-139MB）

`utils/YatoriCoreInit.go` 现状：两个 70MB exe 无条件 embed，但只有
`internal/api/icve/IcveTencentPass.go` 会用到。建议：

```go
# utils/YatoriCoreInit.go —— 移除这两行
-//go:embed assets/tencentCollect.exe
-//go:embed assets/tencentPowSolve.exe
```

```go
# 新增 utils/YatoriCoreInit_tencent.go
//go:build yatori_tencent_solver

package utils

import "embed"

//go:embed assets/tencentCollect.exe
//go:embed assets/tencentPowSolve.exe
var tencentAssets embed.FS

func init() {
  // 向 assetsList 追加（或改用变量合并）
  assetsList = append(assetsList, "tencentCollect.exe", "tencentPowSolve.exe")
  registerEmbed(tencentAssets)
}
```

ICVE 构建加 `-tags yatori_tencent_solver`，其余平台（英华/学习通/…）
立即省 139MB。`embed.FS` 合并需要一个小的注册函数（或直接把 assets
拆成两个 FS、读取处先查主 FS 再查备用）。

**同类**：`assets/faces`、`cmap.json` 若也只有个别平台用，可一并拆分。

### 2. ddddocr-go：每架构只嵌自己（上游库，-22.5MB 每平台）

`ocr_lib_windows.go` 里同一 x64 DLL 的 `//go:embed` 还**写了两遍**
（Go 会去重，但属于笔误）。更优结构：每个架构一个文件 + `//go:build
windows && amd64` 约束，`sharedLibName` 也随之简化。

### 3. ddddocr-go：模型按需嵌入（-~23MB，可选）

三个模型（common_old / common_tencent / calc_det）全量嵌入，但一次进程
通常只用一类验证码。可用构建标签 `ddddocr_model_tencent` 等拆分，默认只
嵌最通用的 common_tencent。

## 预期

| 措施 | 英华网关体积 |
|---|---|
| 现状 | 226.1 MB |
| + 方案 1 | ~87 MB（**本地实验实测：87.2 MB，-139MB 分毫不差**） |
| + 方案 2 | ~65 MB（未测，22.5MB 为资产文件字节合计） |
| + 方案 3 | ~45 MB（未测，粗估） |

实验方法（2026-11-02，可复现）：在 core 克隆上按方案 1 移除两行 `//go:embed`
与 `assetsList` 对应两项（共 122 字节源码改动），网关 `go.mod` 临时 `replace`
指回该克隆，`CGO_ENABLED=1 go build -trimpath -ldflags "-s -w"` 编译，
产物 87.2 MB；对照原锁定版 226.1 MB。实验后还原全部改动。

## 备注

- `writeAssetsToDisk` 会把全部 assetsList 释放到 `./assets/`，但只有
  `YatoriCoreInit()` 被调用时才写；英华驱动只走 `EnsureOCR()`
  （ddddocr 初始化），所以当前 145MB 里腾讯部分**从不释放、纯粹占坑**。
- 本仓库 `start.bat`/Dockerfile 无需改动；瘦身属上游收益。
- 若要最小可辩护 PR：先提方案 2（纯笔误级，含重复 embed 行清理），
  方案 1 需要维护者接受构建标签模式后再提。
