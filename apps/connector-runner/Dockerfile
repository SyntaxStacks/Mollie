FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @reselleros/db db:generate
RUN pnpm --filter @reselleros/connector-runner build

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@reselleros/connector-runner", "start"]
