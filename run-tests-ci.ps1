Set-Location -Path $PSScriptRoot
$env:CI = 'true'
npx playwright test tests/online-menus --project=online-menus-chromium
