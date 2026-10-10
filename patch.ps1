#requires -Version 5.1
param([string]$Command = 'install')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host '需要先安装 Node.js 才能运行汉化补丁（只需安装一次，约一分钟）。'
    $answer = Read-Host '是否现在使用 winget 自动安装 Node.js？[Y/n]'
    if ($answer -eq '' -or $answer -match '^[Yy]') {
      winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      $nodeBin = 'C:\Program Files\nodejs'
      if (Test-Path $nodeBin) { $env:Path = "$nodeBin;$env:Path" }
      if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host 'Node.js 已安装完成，请关闭本窗口后重新运行本脚本。'
        exit 1
      }
    } else {
      Write-Host '请先安装 Node.js（https://nodejs.org），然后重新运行本脚本。'
      exit 1
    }
  }
  node (Join-Path $PSScriptRoot 'dist\patcher.cjs') $Command @args
  exit $LASTEXITCODE
} catch {
  Write-Host ''
  Write-Host "[错误] $_"
  exit 1
}
