<#
  Transcodes CLI bootstrap installer — Windows (PowerShell).

    Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex

  Prefer a standard (non-Administrator) PowerShell window. If policy still
  blocks, keep the Bypass -Scope Process prefix above (session-only).

  What it does (npm never has to be typed by the user):
    1. Ensures Node.js >= 20 exists — installs an LTS via winget -> Chocolatey
       -> Scoop, and if none of those exist, drops a portable Node into
       %USERPROFILE%\.transcodes\node and puts it on PATH.
    2. Ensures Git is on PATH (marketplace clone needs it) — winget -> Chocolatey
       -> Scoop, else opens the Git for Windows download page.
    3. Runs `npm install -g @bigstrider/transcodes-cli`.
    4. Fixes PATH (npm global prefix + portable node + Git) for both this session
       and the persistent User environment, so `transcodes` works in a new terminal.

  The CLI and the guard hooks both run on Node, so Node is the one hard
  prerequisite. This is the pre-Node counterpart to `cli/src/commands/transcodes/install.ts`
  ensureNode(), which cannot run until Node already exists.
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# WinPS 5.1: Invoke-WebRequest progress UI makes large downloads extremely slow.
$ProgressPreference = 'SilentlyContinue'

$Pkg            = '@bigstrider/transcodes-cli'
$MinNodeMajor   = 20
$TranscodesHome = Join-Path $env:USERPROFILE '.transcodes'
$PortableRoot   = Join-Path $TranscodesHome 'node'

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Write-Note($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# This file is normally evaluated inside the user's current PowerShell via
# `irm ... | iex`. Calling `exit` here closes that entire terminal window.
# Throwing stops the chained command while leaving an interactive shell open,
# so the user can read the error and retry after fixing the prerequisite.
function Die($m) {
    throw [System.InvalidOperationException]::new("Transcodes install failed: $m")
}

function Test-IsAdministrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

# Run package managers as optional attempts. On some Windows configurations
# (notably elevated shells where App Installer is not registered), winget can
# emit a terminating error. Never let that prevent the portable/fallback path.
function Invoke-InstallAttempt($label, [scriptblock]$command) {
    try {
        $LASTEXITCODE = 0
        & $command
        $code = $LASTEXITCODE
        if ($null -ne $code -and $code -ne 0) {
            Write-Note "$label returned exit code $code; checking whether installation still succeeded…"
            return $false
        }
        return $true
    } catch {
        Write-Note "$label could not run: $($_.Exception.Message)"
        return $false
    }
}

# Re-read PATH from the registry so freshly-installed tools become visible
# in this same session without opening a new terminal.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Persistently add a directory to the User PATH (idempotent) and to this session.
function Add-ToUserPath($dir) {
    if (-not $dir) { return }
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($current) { $parts = $current -split ';' | Where-Object { $_ } }
    if ($parts -notcontains $dir) {
        $new = (@($parts + $dir) -join ';')
        [Environment]::SetEnvironmentVariable('Path', $new, 'User')
        Write-Ok "Added to PATH: $dir"
    }
    if (($env:Path -split ';') -notcontains $dir) {
        $env:Path = "$dir;$env:Path"
    }
}

function Get-NodeMajor {
    if (-not (Test-Command 'node')) { return 0 }
    try {
        $v = (& node -v) 2>$null      # e.g. v22.11.0
        if ($v -match 'v?(\d+)') { return [int]$Matches[1] }
    } catch {}
    return 0
}

function Get-NodeArch {
    # x64 PowerShell on ARM64 Windows reports AMD64 for PROCESSOR_ARCHITECTURE;
    # the real OS arch is in PROCESSOR_ARCHITEW6432.
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
        return 'arm64'
    }
    return 'x64'
}

# ---------------------------------------------------------------------------
# 1. Node.js >= 20
# ---------------------------------------------------------------------------
function Install-PortableNode {
    Write-Note 'Package managers unavailable or failed — downloading portable Node LTS…'
    $arch = Get-NodeArch

    # Resolve the latest LTS version dynamically (no stale pin).
    try {
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
        $lts   = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
    } catch {
        Die "could not reach nodejs.org to resolve the LTS version ($($_.Exception.Message))"
    }
    if (-not $lts) { Die 'could not determine the latest Node LTS version' }

    $name = "node-$lts-win-$arch"
    $url  = "https://nodejs.org/dist/$lts/$name.zip"
    $zip  = Join-Path $env:TEMP "$name.zip"

    Write-Step "Downloading $name…"
    Invoke-WebRequest -Uri $url -OutFile $zip

    if (Test-Path $PortableRoot) { Remove-Item $PortableRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $PortableRoot | Out-Null
    Expand-Archive -Path $zip -DestinationPath $PortableRoot -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue

    # The zip extracts to <PortableRoot>\node-vX-win-arch\ (node.exe, npm, npx).
    $binDir = Join-Path $PortableRoot $name
    if (-not (Test-Path (Join-Path $binDir 'node.exe'))) {
        Die "portable Node extraction failed (node.exe not found under $binDir)"
    }
    Add-ToUserPath $binDir
}

function Ensure-Node {
    Write-Step "Checking Node.js (need >= $MinNodeMajor)"
    Update-SessionPath
    if ((Get-NodeMajor) -ge $MinNodeMajor) {
        Write-Ok "Node.js $(& node -v) already installed"
        return
    }

    Write-Note 'Node.js not found (or too old) — installing an LTS…'

    if (Test-Command 'winget') {
        Write-Step 'Installing Node LTS via winget…'
        # --silent + accept agreements so the piped-into-iex flow is non-interactive.
        Invoke-InstallAttempt 'winget (Node.js)' {
            winget install --id OpenJS.NodeJS.LTS -e --silent `
                --accept-package-agreements --accept-source-agreements
        } | Out-Null
        Update-SessionPath
    }

    if ((Get-NodeMajor) -lt $MinNodeMajor -and (Test-Command 'choco')) {
        Write-Step 'Installing Node LTS via Chocolatey…'
        Invoke-InstallAttempt 'Chocolatey (Node.js)' {
            choco install nodejs-lts -y
        } | Out-Null
        Update-SessionPath
    }

    if ((Get-NodeMajor) -lt $MinNodeMajor -and (Test-Command 'scoop')) {
        Write-Step 'Installing Node LTS via Scoop…'
        Invoke-InstallAttempt 'Scoop (Node.js)' {
            scoop install nodejs-lts
        } | Out-Null
        Update-SessionPath
    }

    if ((Get-NodeMajor) -lt $MinNodeMajor) {
        Install-PortableNode
    }

    if ((Get-NodeMajor) -lt $MinNodeMajor) {
        Die "Node.js $MinNodeMajor+ is required. Install it from https://nodejs.org and re-run this script."
    }
    Write-Ok "Node.js $(& node -v) ready"
}

# ---------------------------------------------------------------------------
# 2. Git (Claude/Codex marketplace + Cursor/Antigravity clone)
# ---------------------------------------------------------------------------
function Ensure-Git {
    Write-Step 'Checking Git'
    Update-SessionPath
    # Official installer lands here — make it visible even if User PATH is stale.
    $gitCmd = Join-Path ${env:ProgramFiles} 'Git\cmd'
    if (Test-Path (Join-Path $gitCmd 'git.exe')) { Add-ToUserPath $gitCmd }
    Update-SessionPath

    if (Test-Command 'git') {
        $ver = try { (& git --version) 2>$null } catch { 'git' }
        Write-Ok "$ver already installed"
        return
    }

    Write-Note 'Git not found — installing (required for plugin marketplace)…'

    if (Test-Command 'winget') {
        Write-Step 'Installing Git via winget…'
        # winget often exits non-zero even on success — ignore and re-check PATH.
        Invoke-InstallAttempt 'winget (Git)' {
            winget install --id Git.Git -e --silent `
                --accept-package-agreements --accept-source-agreements
        } | Out-Null
        Update-SessionPath
        if (Test-Path (Join-Path $gitCmd 'git.exe')) { Add-ToUserPath $gitCmd }
        Update-SessionPath
    }

    if (-not (Test-Command 'git') -and (Test-Command 'choco')) {
        Write-Step 'Installing Git via Chocolatey…'
        Invoke-InstallAttempt 'Chocolatey (Git)' {
            choco install git -y
        } | Out-Null
        Update-SessionPath
    }

    if (-not (Test-Command 'git') -and (Test-Command 'scoop')) {
        Write-Step 'Installing Git via Scoop…'
        Invoke-InstallAttempt 'Scoop (Git)' {
            scoop install git
        } | Out-Null
        Update-SessionPath
    }

    if (Test-Command 'git') {
        Write-Ok "$(& git --version) ready"
        return
    }

    Write-Note 'Could not install Git automatically.'
    Write-Note 'Install Git for Windows from https://git-scm.com/download/win then re-run.'
    try { Start-Process 'https://git-scm.com/download/win' } catch {}
    Die 'Git is required for plugin install (marketplace clone).'
}

# ---------------------------------------------------------------------------
# 3. Install the CLI
# ---------------------------------------------------------------------------
function Install-Cli {
    Write-Step "Installing $Pkg"
    if (-not (Test-Command 'npm')) {
        Die 'npm is missing even though Node is installed — reopen PowerShell and retry.'
    }
    & npm install -g $Pkg
    if ($LASTEXITCODE -ne 0) { Die 'npm install -g failed' }

    # npm's global prefix (where transcodes.cmd lands) is the usual PATH gap on
    # Windows — make sure it is registered for new terminals.
    try {
        $prefixOut = & npm prefix -g 2>$null
        if ($null -ne $prefixOut) {
            $prefix = ([string]$prefixOut).Trim()
            if ($prefix -and (Test-Path $prefix)) { Add-ToUserPath $prefix }
        }
    } catch {}
    # Fallback to the default global bin location.
    if ($env:APPDATA) { Add-ToUserPath (Join-Path $env:APPDATA 'npm') }

    # Stable launcher for AI hosts that do not inherit the user PATH.
    try {
        # The JS entry, not `Get-Command transcodes` — that resolves to npm's
        # transcodes.cmd shim, and node cannot execute a batch file.
        $entry = $null
        $prefixOut = & npm prefix -g 2>$null
        if ($null -ne $prefixOut) {
            $candidate = Join-Path ([string]$prefixOut).Trim() 'node_modules\@bigstrider\transcodes-cli\dist\index.js'
            if (Test-Path $candidate) { $entry = $candidate }
        }
        $node = (Get-Command node -ErrorAction SilentlyContinue).Source
        if ($entry -and $node) {
            $binDir = Join-Path $TranscodesHome 'bin'
            New-Item -ItemType Directory -Force -Path $binDir | Out-Null
            $dest = Join-Path $binDir 'transcodes.cmd'
            $nodeDir = Split-Path $node -Parent
            @"
@echo off
rem transcodes-cli-launcher - written by the transcodes installer. Safe to delete.
set "PATH=$nodeDir;%PATH%"
"$node" "$entry" %*
exit /b %errorlevel%
"@ | Set-Content -Path $dest -Encoding ASCII
            Write-Ok $dest
        }
    } catch {}
}

# ---------------------------------------------------------------------------
# 4. Verify
# ---------------------------------------------------------------------------
function Verify {
    Write-Step 'Verifying'
    Update-SessionPath
    if (Test-Command 'transcodes') {
        $ver = try { (& transcodes version) 2>$null } catch { '' }
        Write-Ok "transcodes $ver"
        Write-Host ''
        Write-Host 'Done.' -ForegroundColor Green -NoNewline
        Write-Host ' Next:'
        Write-Host '  transcodes install   ' -NoNewline -ForegroundColor DarkGray
        Write-Host 'set up the guard plugin + your token'
        Write-Host '  transcodes           ' -NoNewline -ForegroundColor DarkGray
        Write-Host 'open the local dashboard'
    } else {
        Write-Note 'transcodes was installed but is not on PATH in THIS window.'
        Write-Note 'Open a NEW PowerShell window and run:  transcodes install'
    }
}

# Optional: after CLI install, run guided setup in this same session
# (PATH already refreshed). Enable with:
#   $env:TRANSCODES_RUN_INSTALL = '1'; irm .../install.ps1 | iex
# Or chain:  irm .../install.ps1 | iex; transcodes install
function Invoke-GuidedInstall {
    if ($env:TRANSCODES_RUN_INSTALL -ne '1') { return }
    Write-Step 'Running transcodes install'
    Update-SessionPath
    if (-not (Test-Command 'transcodes')) {
        Die 'transcodes is not on PATH — open a new PowerShell window and run: transcodes install'
    }
    & transcodes install
    if ($LASTEXITCODE -ne 0) { Die 'transcodes install failed' }
}

Write-Host 'Transcodes CLI installer' -ForegroundColor White
if (Test-IsAdministrator) {
    Write-Note 'Administrator PowerShell detected.'
    Write-Note 'A standard PowerShell window is recommended; continuing safely for this account.'
}
Ensure-Node
Ensure-Git
Install-Cli
Verify
Invoke-GuidedInstall
