param(
 [string]$Package, [string]$Sha256, [string]$Prefix,
 [switch]$Uninstall, [switch]$Rollback,
 [string]$SandboxRoot
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24+ with npm from https://nodejs.org/en/download, reopen PowerShell, and rerun this script.' }
$installerArgs = @((Join-Path $PSScriptRoot 'installer.mjs'))
foreach ($item in @(@('--package',$Package),@('--sha256',$Sha256),@('--prefix',$Prefix),@('--sandbox',$SandboxRoot))) { if ($item[1]) { $installerArgs += $item } }
if ($Uninstall) { $installerArgs += '--uninstall' }
if ($Rollback) { $installerArgs += '--rollback' }
$resultText = & node @installerArgs
if ($LASTEXITCODE -ne 0) { throw 'TIM installation did not complete. See the error above.' }
$result = $resultText | ConvertFrom-Json
if ($result.action -eq 'uninstalled') {
 if ($result.pathAdded) { $parts = @($env:PATH -split ';'); $removed = $false; $env:PATH = (($parts | Where-Object { if (-not $removed -and $_.TrimEnd('\') -ieq $result.bin.TrimEnd('\')) { $removed = $true; $false } else { $true } }) -join ';') }
} elseif (-not (($env:PATH -split ';') | Where-Object { $_.TrimEnd('\') -ieq $result.bin.TrimEnd('\') })) { $env:PATH = $result.bin + ';' + $env:PATH }
Write-Output $result.message
Write-Output ('Install root: ' + $result.root)
