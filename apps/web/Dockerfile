FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @reselleros/web build

ENV NODE_ENV=production
ENV PORT=3000

CMD ["pnpm", "--filter", "@reselleros/web", "start"]
