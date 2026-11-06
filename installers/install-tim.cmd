@echo off
setlocal DisableDelayedExpansion
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24+ with npm from https://nodejs.org/en/download, reopen your terminal, and rerun. 1>&2
  exit /b 1
)
node "%~dp0installer.mjs" --human %*
exit /b %errorlevel%
