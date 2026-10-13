@echo off
cd /d "%~dp0"
echo ==========================================
echo  The Learning Minds - First Time Setup
echo ==========================================
echo.
echo Installing required files (only happens once, may take a few minutes)...
call npm install
echo.
echo Now let's create the Principal/Admin account.
echo You will be asked for: full name, a username, and a temporary password.
echo.
call npm run create-admin
echo.
echo ==========================================
echo  Setup complete! Now double-click "Start-Website" any time.
echo ==========================================
pause
