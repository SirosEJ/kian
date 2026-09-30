FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/connectors/package.json packages/connectors/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY packages/contracts packages/contracts
COPY packages/connectors packages/connectors
COPY apps/api apps/api
COPY apps/web apps/web
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
COPY firebase-public.en[v] ./
RUN if [ -f firebase-public.env ]; then set -a; . ./firebase-public.env; set +a; fi; pnpm build

FROM node:24-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/connectors/package.json packages/connectors/package.json
RUN pnpm install --prod --filter "@kian/api..." --frozen-lockfile
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY scripts scripts
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/connectors/dist packages/connectors/dist
COPY --from=build /app/apps/web/dist apps/web/dist
ENV NODE_ENV=production PORT=8080 WEB_DIST_PATH=/app/apps/web/dist
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
