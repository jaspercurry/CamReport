#!/bin/bash
set -e

cd "$(dirname "$0")"

# Create screenshots directory
mkdir -p ~/Desktop/webcam-cal

# Install Python dependencies
echo "Installing Python dependencies..."
pip3 install -q -r backend/requirements.txt

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd frontend && npm install --silent && cd ..

# Start backend
echo "Starting backend on :8000..."
python3 backend/server.py &
BACKEND_PID=$!

# Start frontend dev server
echo "Starting frontend on :5173..."
cd frontend && npm run dev &
FRONTEND_PID=$!

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

echo ""
echo "CamReport is running!"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Drop screenshots into ~/Desktop/webcam-cal/"
echo "Press Ctrl+C to stop."

wait
