@echo off
title NDC Sizer - Netwrix Data Classification Sizing Tool

echo.
echo  ================================================
echo   NDC Sizer - Netwrix Data Classification Tool
echo  ================================================
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed.
    echo  Please download and install it from: https://nodejs.org
    echo  Then run this script again.
    pause
    exit /b 1
)

:: Install dependencies if missing
if not exist node_modules (
    echo  Installing dependencies ^(first run only^)...
    npm install
    echo.
)

echo  Starting NDC Sizer...
echo  Opening browser at http://localhost:3737
echo.
echo  Press Ctrl+C to stop the server.
echo.

start "" http://localhost:3737
node server.js
