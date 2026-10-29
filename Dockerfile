FROM node:24.17.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY scripts/build-server.ts scripts/validate-static-assets.ts ./scripts/
COPY src ./src
COPY docs ./docs
COPY database/migrations ./database/migrations
RUN npm run build && npm prune --omit=dev

FROM node:24.17.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    STUDY_HOST=0.0.0.0 \
    STUDY_PORT=3000 \
    STUDY_DB_PATH=/data/central.sqlite3
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/build/src ./build/src
COPY --chown=node:node --from=build /app/build/docs ./build/docs
COPY --chown=node:node --from=build /app/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const origin = new URL(process.env.STUDY_ORIGIN || 'http://127.0.0.1:3000'); require('node:http').get({host:'127.0.0.1',port:3000,path:'/api/health',headers:{Host:origin.host}},r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "build/src/server/main.js"]
