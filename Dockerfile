# Cosign web app (Next.js) with the agents, the Executor library and the deployment records it reads at runtime.
# Build:  docker build -t cosign .
# Run:    see docs/DEPLOY.md for the environment (a Postgres URL, Circle credentials, your admin wallet).
FROM node:22-slim AS build
WORKDIR /app
COPY agents/package*.json agents/
COPY executor/package*.json executor/
COPY frontend/package*.json frontend/
RUN npm ci --prefix agents && npm ci --prefix executor && npm ci --prefix frontend
COPY agents agents
COPY executor executor
COPY frontend frontend
COPY deployments deployments
RUN cd frontend && npx next build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 COSIGN_ROOT=/app
COPY --from=build /app /app
# No secrets are baked into the image. At run time the server needs DATABASE_URL, CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET,
# COSIGN_CIRCLE_WALLETS, COSIGN_RELAYER_PRIVATE_KEY and COSIGN_ADMIN_ADDRESSES. Without them it refuses to run in production.
USER node
WORKDIR /app/frontend
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
