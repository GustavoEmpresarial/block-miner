FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y rclone ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data backups logs && \
    chmod +x docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]

