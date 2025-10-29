#!/bin/bash

# Crypto Sentinel Process Management Script
# Helps manage proxy server processes and prevent conflicts

PORT=3003
FRONTEND_PORT=5174

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[PROCESS_MANAGER]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PROCESS_MANAGER]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[PROCESS_MANAGER]${NC} $1"
}

print_error() {
    echo -e "${RED}[PROCESS_MANAGER]${NC} $1"
}

# Function to check port status
check_ports() {
    print_status "Checking port status..."
    
    # Check proxy server port
    if lsof -ti:$PORT >/dev/null 2>&1; then
        print_warning "Port $PORT is in use"
        lsof -i:$PORT
    else
        print_success "Port $PORT is free"
    fi
    
    # Check frontend port
    if lsof -ti:$FRONTEND_PORT >/dev/null 2>&1; then
        print_warning "Port $FRONTEND_PORT is in use"
        lsof -i:$FRONTEND_PORT
    else
        print_success "Port $FRONTEND_PORT is free"
    fi
}

# Function to kill all proxy processes
kill_proxy() {
    print_status "Killing all proxy server processes..."
    
    # Kill by port
    if lsof -ti:$PORT >/dev/null 2>&1; then
        lsof -ti:$PORT | xargs kill -9 2>/dev/null
        print_success "Killed processes on port $PORT"
    else
        print_success "No processes found on port $PORT"
    fi
    
    # Kill by process name
    pkill -f "node.*proxy-server" 2>/dev/null
    print_success "Killed proxy-server processes"
}

# Function to kill all frontend processes
kill_frontend() {
    print_status "Killing all frontend processes..."
    
    # Kill by port
    if lsof -ti:$FRONTEND_PORT >/dev/null 2>&1; then
        lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null
        print_success "Killed processes on port $FRONTEND_PORT"
    else
        print_success "No processes found on port $FRONTEND_PORT"
    fi
    
    # Kill by process name
    pkill -f "vite" 2>/dev/null
    print_success "Killed vite processes"
}

# Function to kill all project processes
kill_all() {
    print_status "Killing all project processes..."
    kill_proxy
    kill_frontend
    print_success "All project processes killed"
}

# Function to start proxy server safely
start_proxy() {
    print_status "Starting proxy server safely..."
    
    # Check if port is free
    if lsof -ti:$PORT >/dev/null 2>&1; then
        print_warning "Port $PORT is in use, cleaning up..."
        kill_proxy
        sleep 2
    fi
    
    # Start the server
    print_status "Starting proxy server..."
    ./start-proxy.sh
}

# Function to show help
show_help() {
    echo "Crypto Sentinel Process Manager"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  check     - Check port status"
    echo "  kill-proxy - Kill proxy server processes"
    echo "  kill-frontend - Kill frontend processes"
    echo "  kill-all  - Kill all project processes"
    echo "  start-proxy - Start proxy server safely"
    echo "  help      - Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 check"
    echo "  $0 kill-all"
    echo "  $0 start-proxy"
}

# Main execution
case "${1:-help}" in
    "check")
        check_ports
        ;;
    "kill-proxy")
        kill_proxy
        ;;
    "kill-frontend")
        kill_frontend
        ;;
    "kill-all")
        kill_all
        ;;
    "start-proxy")
        start_proxy
        ;;
    "help"|*)
        show_help
        ;;
esac
