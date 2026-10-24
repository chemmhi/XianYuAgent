set -eu
docker exec xianyu-agent-prod-api-1 tar --exclude='*/profile-before' --exclude='*/profile-after' --exclude='*/recorder-source-*' -C /tmp -czf - xianyu-slider-recording-20261023 xianyu-slider-recording-20261023-browser xianyu-slider-recording-20261023-endpoint
