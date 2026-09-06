# OneAPIChat DSH stability: join Windows ZeroTier node to Aliyun moon (047f34d1cd)
# Written by agent; safe to rerun. Requires admin OR membership in Administrators.

$ErrorActionPreference = 'Continue'

function Join-ZtPath {
    param([string]$Tail)
    return Join-Path $env:ProgramData (Join-Path 'ZeroTier' $Tail)
}

$confPath = Join-ZtPath (Join-Path 'One' 'local.conf')
$cliBat   = Join-Path 'C:' (Join-Path 'Program Files (x86)' (Join-Path 'ZeroTier' (Join-Path 'One' 'zerotier-cli.bat')))

Write-Host 'STEP 1: write local.conf (moonIds)'
try {
  $content = '{"settings":{"moonIds":["047f34d1cd"]}}'
  Set-Content -LiteralPath $confPath -Value $content -Force -Encoding ASCII
  Write-Host ('  written: ' + $confPath)
} catch {
  Write-Host ('  local.conf write skipped: ' + $PSItem.Exception.Message)
}

Write-Host 'STEP 2: orbit moon dynamically (no service restart needed)'
& $cliBat orbit 047f34d1cd 047f34d1cd
Start-Sleep -Seconds 8

Write-Host 'STEP 3: verify peers (expect MOON/DIRECT, not RELAY)'
& $cliBat peers
Write-Host 'DONE.'
