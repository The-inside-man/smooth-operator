@echo off
cd /d "%~dp0"
if exist "release\win-unpacked\TIM Studio.exe" (
  start "" "release\win-unpacked\TIM Studio.exe"
) else (
  call npm run desktop
)
