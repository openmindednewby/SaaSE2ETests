@echo off
REM =====================================
REM Start SaaS stack in ONE WT window
REM =====================================

wt ^
  new-tab --title "IdentityService" cmd /k ^
    "cd /d C:\desktopContents\projects\SaaS\IdentityService && docker-compose up" ^
; split-pane -H --title "OnlineMenuService" cmd /k ^
    "cd /d C:\desktopContents\projects\SaaS\OnlineMenuSaaS\OnlineMenuService && docker-compose up" ^
; move-focus left ^
; split-pane -V --title "QuestionerService" cmd /k ^
    "cd /d C:\desktopContents\projects\SaaS\QuestionerService && docker-compose up" ^
; move-focus right ^
; split-pane -V --title "Frontend" cmd /k ^
    "cd /d C:\desktopContents\projects\SaaS\OnlineMenuSaaS\clients\OnlineMenuClientApp && npm run start:dev" ^
; move-focus down ^
; split-pane -H --size 0.3 --title "Playwright E2E Tests" cmd /k ^
    "timeout /t 60 /nobreak && cd /d C:\desktopContents\projects\SaaS\E2ETests && npm test"
