#!/bin/bash
cd "$(dirname "$0")"
echo "Starting The Learning Minds website..."
echo "When it says 'running at http://localhost:3000', your browser will open automatically."
echo "To stop the website, close this window."
sleep 2 && open http://localhost:3000 &
npm start
