#Requires -Version 5.1
<#
.SYNOPSIS
    ClawControl installer for Windows.
.DESCRIPTION
    Installs Bun, Node.js (if needed) and the ClawControl CLI.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── Helpers ────────────────────────────────────────────────────────────────

function Write-Banner {
    $banner = @"

   _____ _                  _____            _             _
  / ____| |                / ____|          | |           | |
 | |    | | __ ___      __| |     ___  _ __ | |_ _ __ ___ | |
 | |    | |/ _`` \ \ /\ / /| |    / _ \| '_ \| __| '__/ _ \| |
 | |____| | (_| |\ V  V / | |___| (_) | | | | |_| | | (_) | |
  \_____|_|\__,_| \_/\_/   \_____\___/|_| |_|\__|_|  \___/|_|

"@
    Write-Host $banner -ForegroundColor Cyan
    Write-Host "  Deploy and manage OpenClaw instances — https://openclaw.ai" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "▸ $Message" -ForegroundColor Cyan
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [info]  $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "    ✔  $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [warn]  $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "  [error] $Message" -ForegroundColor Red
}

# ─── Banner ─────────────────────────────────────────────────────────────────

Write-Banner

# ─── Detect system ──────────────────────────────────────────────────────────

Write-Step "Detecting system"

$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
Write-Success "Windows ($arch)"

# ─── Check Bun ──────────────────────────────────────────────────────────────

Write-Step "Checking Bun runtime"

$bunOk = $false

try {
    $bunVersionRaw = & bun --version 2>$null
    if ($bunVersionRaw) {
        Write-Success "Bun v$bunVersionRaw found"
        $bunOk = $true
    }
} catch {}

if (-not $bunOk) {
    Write-Warn "Bun is required but was not found."
    Write-Info "Installing Bun..."

    # Use the official Bun installer for Windows
    powershell -c "irm bun.sh/install.ps1 | iex"

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    # Also add the default Bun install location
    $bunBin = Join-Path $env:USERPROFILE ".bun\bin"
    if (Test-Path $bunBin) {
        $env:Path = "$bunBin;$env:Path"
    }

    try {
        $bunVersionRaw = & bun --version 2>$null
        if ($bunVersionRaw) {
            Write-Success "Bun v$bunVersionRaw installed"
            $bunOk = $true
        }
    } catch {}

    if (-not $bunOk) {
        Write-Err "Bun installation failed. Please install Bun manually: https://bun.sh"
        exit 1
    }
}

# ─── Check Node.js ─────────────────────────────────────────────────────────

Write-Step "Checking Node.js"

$requiredMajor = 20
$nodeOk = $false

try {
    $nodeVersionRaw = & node -v 2>$null
    if ($nodeVersionRaw) {
        $nodeVersion = $nodeVersionRaw -replace '^v', ''
        $nodeMajor = [int]($nodeVersion.Split('.')[0])
        if ($nodeMajor -ge $requiredMajor) {
            Write-Success "Node.js v$nodeVersion found"
            $nodeOk = $true
        } else {
            Write-Warn "Node.js v$nodeVersion found but v$requiredMajor+ is required."
        }
    }
} catch {}

if (-not $nodeOk) {
    Write-Warn "Node.js >= $requiredMajor is required but was not found."
    Write-Host ""

    $hasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)

    if ($hasWinget) {
        Write-Info "Installing Node.js via winget..."
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        try {
            $nodeVersionRaw = & node -v 2>$null
            if ($nodeVersionRaw) {
                Write-Success "Node.js $nodeVersionRaw installed via winget"
                $nodeOk = $true
            }
        } catch {}
    }

    if (-not $nodeOk) {
        Write-Err "Could not install Node.js automatically."
        Write-Err "Please install Node.js >= $requiredMajor from https://nodejs.org/ and re-run this script."
        exit 1
    }
}

# ─── Install ClawControl ───────────────────────────────────────────────────

Write-Step "Installing ClawControl"

# Use bun for install since it's already verified
$installCmd = "bun add -g clawcontrol"

Write-Info "Running: $installCmd"
Invoke-Expression $installCmd

# Refresh PATH after global install
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

$bunBin = Join-Path $env:USERPROFILE ".bun\bin"
if (Test-Path $bunBin) {
    $env:Path = "$bunBin;$env:Path"
}

$clawExists = $null -ne (Get-Command clawcontrol -ErrorAction SilentlyContinue)

if ($clawExists) {
    Write-Success "ClawControl installed successfully!"
} else {
    Write-Warn "clawcontrol was installed but is not in PATH."
    Write-Warn "You may need to open a new terminal window."
}

# ─── Done ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ──────────────────────────────────────────" -ForegroundColor Green
Write-Host "  ClawControl is ready!" -ForegroundColor Green
Write-Host "  ──────────────────────────────────────────" -ForegroundColor Green
Write-Host ""
Write-Host "  Get started:"
Write-Host ""
Write-Host "    clawcontrol" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Then type /new to create your first deployment."
Write-Host ""
Write-Host "  Docs: https://openclaw.ai  •  Issues: https://github.com/ipenywis/clawcontrol/issues" -ForegroundColor DarkGray
Write-Host ""
