#!/bin/zsh
# luna takes a screenshot so she can check her work. saves to tools/screen.png
cd "$(dirname "$0")" && screencapture -x -C screen.png && sips -Z 1600 screen.png >/dev/null 2>&1; echo "saved tools/screen.png"
