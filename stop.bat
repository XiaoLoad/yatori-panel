@echo off
chcp 65001 >nul
echo Stopping yatori-panel...

rem gateway: unique image name, kill directly
taskkill /F /IM gateway.exe >nul 2>&1

rem panel backend: match our node process by command line signature
rem (index.ts) so other node programs on this machine are not touched
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'index.ts' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

timeout /t 1 /nobreak >nul
netstat -ano | findstr /C:":8080 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo Stopped: panel 8080 and gateway 9801 are both closed.
) else (
  echo [!] Port 8080 is still in use by another program.
)
pause
