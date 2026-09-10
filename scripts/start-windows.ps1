$ErrorActionPreference = "Stop"

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  throw "Created .env.local. Add your API key, then run this script again."
}

npm run dev
