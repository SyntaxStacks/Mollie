FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @reselleros/db db:generate
RUN pnpm --filter @reselleros/jobs... build
RUN pnpm --filter @reselleros/jobs deploy --legacy --prod /prod/jobs

FROM node:22-bookworm-slim AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /prod/jobs ./
RUN pnpm --dir /app/node_modules/@reselleros/db db:generate

CMD ["pnpm", "start"]
