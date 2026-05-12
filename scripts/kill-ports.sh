#!/bin/bash
# Kill all processes occupying AgentView dev ports

PORTS=(1990 1991 1992 1995 1999)

for port in "${PORTS[@]}"; do
  pids=$(lsof -ti :"$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Port $port: killing PIDs $pids"
    echo "$pids" | xargs kill -9
  else
    echo "Port $port: free"
  fi
done
