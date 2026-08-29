FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=optional

COPY bin ./bin
COPY scripts ./scripts
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8789

CMD ["npm", "run", "gateway"]
