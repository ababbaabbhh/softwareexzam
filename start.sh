#!/usr/bin/env bash
# 启动考试服务（后台常驻）。已运行时直接返回。
cd "$(dirname "$0")" || exit 1
if node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  echo "考试服务已在运行: http://127.0.0.1:8787"
  exit 0
fi
setsid nohup node server.mjs > /tmp/softexam.log 2>&1 < /dev/null &
sleep 2
if node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  echo "考试服务已启动"
  echo "  本机:   http://127.0.0.1:8787"
  echo "  局域网: http://<本机IP>:8787（手机与电脑需在同一 Wi-Fi）"
else
  echo "启动失败，请查看 /tmp/softexam.log"
  exit 1
fi
