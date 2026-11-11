FROM oven/bun:1.2.16 AS bun
FROM node:24.21.0-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /work
