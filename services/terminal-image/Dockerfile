FROM node:22-bookworm

ARG CLAUDE_CODE_VERSION=2.1.251
WORKDIR /opt/nates-software

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash build-essential ca-certificates curl file git git-lfs gzip jq less nano \
    openssh-client pkg-config procps python3 python3-pip python3-venv ripgrep \
    rsync sqlite3 tar tree unzip vim-tiny wget zip \
    && rm -rf /var/lib/apt/lists/*

# The immutable snapshot contains the suite CLI and its runtime dependencies.
# Session data is created only under /workspace, which Daytona destroys.
COPY package.json package-lock.json ./
RUN npm ci && npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
COPY bin ./bin
COPY src ./src
RUN ln -s /opt/nates-software/bin/slop /usr/local/bin/slop \
    && chmod +x /opt/nates-software/bin/slop \
    && useradd --create-home --shell /bin/bash daytona \
    && mkdir -p /workspace \
    && chown -R daytona:daytona /workspace

COPY services/terminal-image/verify-toolchain.sh /usr/local/bin/verify-terminal-toolchain
RUN chmod +x /usr/local/bin/verify-terminal-toolchain && verify-terminal-toolchain

USER daytona
WORKDIR /workspace
ENV HOME=/home/daytona TERM=xterm-256color
CMD ["sleep", "infinity"]
