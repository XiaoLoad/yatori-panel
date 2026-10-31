@echo off
chcp 65001 >nul
cd /d %~dp0

where bun >nul 2>nul
if errorlevel 1 (
  echo [!] 未检测到 bun，请先安装：https://bun.sh
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] 安装依赖...
  call bun install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist "gateway\bin\gateway.exe" (
  echo [2/3] 构建网关（需要 Go 与 GCC，仅首次）...
  call bun run gateway:build
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist "apps\web\dist\index.html" (
  echo [3/3] 构建前端...
  cd apps\web
  call bunx vite build
  cd ..\..
)

echo 启动 yatori-panel...
start "yatori-gateway" /min gateway\bin\gateway.exe -addr 127.0.0.1:9801
start "yatori-panel" /min cmd /c "cd /d %~dp0apps\server && node src\index.ts"
timeout /t 2 /nobreak >nul
start http://127.0.0.1:8080
echo 面板地址: http://127.0.0.1:8080（本窗口可关闭）
pause
