# Shared environment for scripts. Source it: `source scripts/env.sh`
# Python venv lives on the Linux filesystem (fast I/O) even though the code is on /mnt/e.
export UV_PROJECT_ENVIRONMENT="${UV_PROJECT_ENVIRONMENT:-$HOME/.venvs/tts-service}"
export UV_LINK_MODE=copy
export PATH="$HOME/.local/bin:$PATH"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT_DIR
