$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20.9 or newer is required. Install it from https://nodejs.org/ and run this script again."
}

$nodeParts = (node --version).TrimStart("v").Split(".")
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 9)) {
  throw "Node.js 20.9 or newer is required. Your version is $(node --version)."
}

npm install

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Created .env.local. Add your Gemini or Anthropic API key before starting the app." -ForegroundColor Yellow
}

$libreOffice = Get-Command soffice -ErrorAction SilentlyContinue
$defaultLibreOffice = Join-Path $env:ProgramFiles "LibreOffice\program\soffice.exe"
if (-not $libreOffice -and -not (Test-Path $defaultLibreOffice)) {
  Write-Host "LibreOffice is needed for PDF export: https://www.libreoffice.org/download/download-libreoffice/" -ForegroundColor Yellow
}

Write-Host "Setup complete. Run .\scripts\start-windows.ps1 and open http://localhost:3000" -ForegroundColor Green
