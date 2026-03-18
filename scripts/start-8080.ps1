param(
  [ValidateSet("dev", "prod")]
  [string]$Mode = "dev",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "[start-8080] Repo root: $repoRoot"
Write-Host "[start-8080] External BaseUrl: http://localhost:8080/v1"

if (-not $SkipInstall) {
  if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    Write-Host "[start-8080] Installing root dependencies..."
    npm install
  }

  if (-not (Test-Path (Join-Path $repoRoot "web\node_modules"))) {
    Write-Host "[start-8080] Installing web dependencies..."
    Push-Location (Join-Path $repoRoot "web")
    try {
      npm install
    } finally {
      Pop-Location
    }
  }
}

Write-Host "[start-8080] Building web assets..."
npm run build:web

if ($Mode -eq "prod") {
  Write-Host "[start-8080] Building server bundle..."
  tsc
  Write-Host "[start-8080] Starting production server on port 8080..."
  node dist/index.js
} else {
  Write-Host "[start-8080] Starting development server on port 8080..."
  npx tsx watch src/index.ts
}