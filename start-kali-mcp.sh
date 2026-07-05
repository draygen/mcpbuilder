#!/bin/bash
# Start the Aion MCP server (includes Kali tools)
cd "$(dirname "$0")"
set -a
[ -f .env ] && source .env
set +a
exec node dist/index.js
