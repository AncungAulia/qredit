FROM oven/bun:1.3
WORKDIR /app

# Workspace manifests first: a frozen install needs every workspace member present.
COPY package.json bun.lock ./
COPY apps/be/package.json apps/be/package.json
COPY engine/package.json engine/package.json
COPY packages/qore/package.json packages/qore/package.json
RUN bun install --frozen-lockfile --production

COPY packages/qore packages/qore
COPY apps/be apps/be

WORKDIR /app/apps/be
ENV NODE_ENV=production
CMD ["bun", "src/server.ts"]
