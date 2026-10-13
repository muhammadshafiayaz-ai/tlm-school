@echo off
cd /d "%~dp0"
echo Starting The Learning Minds website...
echo When it says "running at http://localhost:3000", open that in your browser.
echo To stop the website, close this window.
start "" http://localhost:3000
call npm start
pause
