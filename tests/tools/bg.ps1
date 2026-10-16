param(
  [Parameter(Mandatory = $true)][string]$Cmd,
  [string]$Target = 'fixed',
  [int]$TimeoutSec = 300
)
# Dev helper: runs a command with a hard timeout and writes .bg.log and .bg.status in the game root.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
Remove-Item -ErrorAction SilentlyContinue .bg.status
$env:GAME_TARGET = $Target
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c $Cmd > .bg.log 2>&1" -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
  'TIMEOUT' | Out-File .bg.status
} else {
  "EXIT $($p.ExitCode)" | Out-File .bg.status
}
