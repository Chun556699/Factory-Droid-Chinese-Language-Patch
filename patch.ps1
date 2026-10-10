#requires -Version 5.1
param([string]$Command = 'install')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$zh = (Get-Culture).Name -match '^zh'
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ''
    if ($zh) {
      Write-Host '需要先安装 Node.js 才能运行汉化补丁（只需安装一次，约一分钟）。'
      $answer = Read-Host '是否现在使用 winget 自动安装 Node.js？[Y/n]'
    } else {
      Write-Host 'Node.js is required to run this patch (one-time install, about a minute).'
      $answer = Read-Host 'Install Node.js automatically via winget now? [Y/n]'
    }
    if ($answer -eq '' -or $answer -match '^[Yy]') {
      winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      $nodeBin = 'C:\Program Files\nodejs'
      if (Test-Path $nodeBin) { $env:Path = "$nodeBin;$env:Path" }
      if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        if ($zh) { Write-Host 'Node.js 已安装完成，请关闭本窗口后重新运行本脚本。' } else { Write-Host 'Node.js installed. Please close this window and run the script again.' }
        exit 1
      }
    } else {
      if ($zh) { Write-Host '请先安装 Node.js（https://nodejs.org），然后重新运行本脚本。' } else { Write-Host 'Please install Node.js (https://nodejs.org) first, then run this script again.' }
      exit 1
    }
  }
  node (Join-Path $PSScriptRoot 'dist\patcher.cjs') $Command @args
  exit $LASTEXITCODE
} catch {
  Write-Host ''
  if ($zh) { Write-Host "[错误] $_" } else { Write-Host "[Error] $_" }
  exit 1
}
