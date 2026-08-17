@echo off
start node service.js
timeout /t 2 /nobreak
start msedge index.html