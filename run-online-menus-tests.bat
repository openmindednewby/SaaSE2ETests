@echo off
cd /d "%~dp0"
npx playwright test tests/online-menus --project=online-menus-chromium
