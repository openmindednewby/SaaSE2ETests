# -----------------------------
# CONFIG – ADJUST PORTS HERE
# -----------------------------
$IdentityPort      = 5002   # e.g. IdentityService
$QuestionerPort    = 5004   # e.g. QuestionerService
$OnlineMenuPort    = 5006   # e.g. OnlineMenuService
$FrontendPort      = 8082   # e.g. Angular/React dev server

# -----------------------------
# Helper: Wait for a port
# -----------------------------
function Wait-ForPort {
    param (
        [string]$Name,
        [int]$Port
    )

    Write-Host "⏳ Waiting for $Name on port $Port..."
    while (-not (Test-NetConnection -ComputerName "localhost" -Port $Port -InformationLevel Quiet)) {
        Start-Sleep -Seconds 2
    }
    Write-Host "✅ $Name is up"
}

# -----------------------------
# Start Services
# -----------------------------

# IdentityService
Start-Process powershell `
  -ArgumentList "-NoExit", "-Command", `
  "`$Host.UI.RawUI.WindowTitle='IdentityService'; cd 'C:\desktopContents\projects\SaaS\IdentityService'; docker-compose up"

# OnlineMenuService
Start-Process powershell `
  -ArgumentList "-NoExit", "-Command", `
  "`$Host.UI.RawUI.WindowTitle='OnlineMenuService'; cd 'C:\desktopContents\projects\SaaS\OnlineMenuSaaS\OnlineMenuService'; docker-compose up"

# QuestionerService
Start-Process powershell `
  -ArgumentList "-NoExit", "-Command", `
  "`$Host.UI.RawUI.WindowTitle='QuestionerService'; cd 'C:\desktopContents\projects\SaaS\QuestionerService'; docker-compose up"

# Frontend
Start-Process powershell `
  -ArgumentList "-NoExit", "-Command", `
  "`$Host.UI.RawUI.WindowTitle='Frontend'; cd 'C:\desktopContents\projects\SaaS\OnlineMenuSaaS\clients\OnlineMenuClientApp'; npm run start:dev"

# -----------------------------
# Wait for all services
# -----------------------------
Wait-ForPort "IdentityService"   $IdentityPort
Wait-ForPort "OnlineMenuService" $OnlineMenuPort
Wait-ForPort "QuestionerService" $QuestionerPort
Wait-ForPort "Frontend"          $FrontendPort

# -----------------------------
# Run Playwright / E2E Tests
# -----------------------------
Start-Process powershell `
  -ArgumentList "-NoExit", "-Command", `
  "`$Host.UI.RawUI.WindowTitle='Playwright E2E Tests'; cd 'C:\desktopContents\projects\SaaS\E2ETests'; npm test"
