# Chabuka API container (Cloud Run). The web app is static and deploys to
# Firebase Hosting (see firebase.json); this image only runs apps/api.
FROM node:22-slim

WORKDIR /app

# Workspace manifests first so the install layer is cached between builds.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @chabuka/shared && npm run build --workspace @chabuka/api

ENV NODE_ENV=production
WORKDIR /app/apps/api
# Cloud Run provides PORT; the API reads it.
CMD ["node", "dist/index.js"]
