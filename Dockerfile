# Cosign web app (Next.js) with the agents, executor verifier and deployment records it reads at runtime.
# Build:  docker build -t cosign .
# Run:    docker run -p 3000:3000 -e COSIGN_AGENT_MNEMONIC="<fresh 12 words>" cosign
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
ENV NODE_ENV=production PORT=3000 COSIGN_STATE_FILE=/tmp/cosign-state.json COSIGN_DEMO_NOW=2026-10-15T12:00:00Z
COPY --from=build /app /app
# Never bake secrets into the image. COSIGN_AGENT_MNEMONIC is required at run time (the app refuses to start without it).
# These keys only SIGN demo attestations; they hold no funds. Use a fresh phrase, never a public one.
USER node
WORKDIR /app/frontend
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
