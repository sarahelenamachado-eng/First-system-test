#!/usr/bin/env sh
# Inicia a plataforma: http://localhost:8765
cd "$(dirname "$0")" && python3 governance/server.py
