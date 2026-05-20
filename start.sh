#!/bin/bash
echo ""
echo " ================================================"
echo "  NDC Sizer - Netwrix Data Classification Tool"
echo " ================================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo " ERROR: Node.js is not installed."
    echo " Please install it from: https://nodejs.org"
    exit 1
fi

# Install dependencies if missing
if [ ! -d "node_modules" ]; then
    echo " Installing dependencies (first run only)..."
    npm install
    echo ""
fi

echo " Starting NDC Sizer at http://localhost:3737"
echo " Press Ctrl+C to stop."
echo ""

# Open browser
sleep 1 && (open http://localhost:3737 2>/dev/null || xdg-open http://localhost:3737 2>/dev/null) &

node server.js
