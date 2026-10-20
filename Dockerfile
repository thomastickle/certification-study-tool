FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY docs ./docs
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    STUDY_HOST=0.0.0.0 \
    STUDY_PORT=3000 \
    STUDY_DB_PATH=/data/library.sqlite3
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/shared ./src/shared
COPY --from=build /app/docs/question-bank.schema.json ./docs/question-bank.schema.json
COPY --from=build /app/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/questions').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server/main.ts"]
