#!/bin/bash
cd /Users/brandonkatz/.openclaw/workspace/mission-control-static
node generate-data.js
git add data.json
git commit -m "Auto: Update dashboard data"
git push
