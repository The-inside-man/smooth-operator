param([Parameter(Mandatory=$true)][string]$Version,[Parameter(Mandatory=$true)][string]$Destination,[switch]$Plan)
$ErrorActionPreference='Stop'
$Version=$Version.TrimStart('v')
if($Version -notmatch '^\d+\.\d+\.\d+$' -or [int]$Version.Split('.')[0] -lt 24){throw 'Choose an explicit Node version 24 or newer.'}
if(-not [IO.Path]::IsPathRooted($Destination)){throw 'Choose an absolute NEW user directory.'}
$Destination=[IO.Path]::GetFullPath($Destination)
$architecture=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}elseif($env:PROCESSOR_ARCHITECTURE -eq 'AMD64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'AMD64'){'x64'}else{'unsupported'}
if($architecture -notin @('x64','arm64')){throw 'Supported architectures: x64 and arm64.'}
$name="node-v$Version-win-$architecture"; $base="https://nodejs.org/dist/v$Version"; $archive="$name.zip"
Write-Host "Source: $base/$archive`nVerification: SHA-256 from official HTTPS metadata; signer not independently authenticated.`nInstall: extract into NEW directory $Destination`nNo PATH, policy, privilege or TIM installation changes."
if($Plan){return}
if(Test-Path -LiteralPath $Destination){throw 'Destination exists; refusing overwrite.'}
if((Read-Host 'Type install to approve this exact runtime/source/directory') -cne 'install'){Write-Host 'Cancelled.'; return}
$parent=Split-Path -Parent $Destination
if(-not(Test-Path -LiteralPath $parent -PathType Container)){throw 'Parent directory must exist.'}
$stage=Join-Path $parent ('.tim-node-'+[guid]::NewGuid().ToString()); New-Item -ItemType Directory -Path $stage | Out-Null
try {
 $sums=Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -MaximumRedirection 0 -TimeoutSec 60
 $matches=@($sums.Content -split "`n" | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+'+[regex]::Escape($archive)+'\s*$') })
 if($matches.Count -ne 1){throw 'Missing/ambiguous official checksum.'}
 $expected=($matches[0] -split '\s+')[0]; $zip=Join-Path $stage 'runtime.zip'
 Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive" -MaximumRedirection 0 -TimeoutSec 300 -OutFile $zip
 if((Get-Item -LiteralPath $zip).Length -gt 134217728){throw 'Runtime archive exceeds size limit.'}
 if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected){throw 'Checksum mismatch; extraction refused.'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $entries=[IO.Compression.ZipFile]::OpenRead($zip)
 try { foreach($entry in $entries.Entries){if(-not $entry.FullName.StartsWith($name+'/') -or $entry.FullName -match '(^|/)\.\.(/|$)|\\'){throw 'Unsafe archive member.'}} } finally {$entries.Dispose()}
 [IO.Compression.ZipFile]::ExtractToDirectory($zip,$stage)
 $runtime=Join-Path $stage $name
 if(-not(Test-Path -LiteralPath (Join-Path $runtime 'node.exe')) -or -not(Test-Path -LiteralPath (Join-Path $runtime 'node_modules/npm/bin/npm-cli.js'))){throw 'Runtime/npm missing.'}
 if(Test-Path -LiteralPath $Destination){throw 'Destination appeared concurrently.'}
 [IO.Directory]::Move($runtime,$Destination)
 Write-Host "Runtime saved at $Destination. No PATH changed. Use its node.exe with bundled installer.mjs; TIM records the runtime path."
} finally {
 $resolved=[IO.Path]::GetFullPath($stage); if($resolved.StartsWith([IO.Path]::GetFullPath($parent).TrimEnd('\')+'\') -and [IO.Path]::GetFileName($resolved).StartsWith('.tim-node-')){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
