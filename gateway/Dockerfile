# 网关需 CGO（验证码 OCR 依赖 onnxruntime_go），用构建容器内的 glibc 工具链编译；
# 运行库与 OCR 模型由 ddddocr-go 内嵌，运行时释放到工作目录 assets/
FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 go build -ldflags "-s -w" -o /out/gateway .

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /out/gateway ./gateway
EXPOSE 9801
ENTRYPOINT ["./gateway", "-addr", "0.0.0.0:9801"]
