FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS install
COPY package.json ./
RUN bun install --production

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=install /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
