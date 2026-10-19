FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
COPY public ./public
COPY prompts ./prompts
COPY mock-samples ./mock-samples
COPY manual-test-samples ./manual-test-samples
RUN npm run build

FROM build AS test
ENV NODE_ENV=test
RUN mkdir -p runtime && chown -R node:node runtime dist
USER node
CMD ["npm", "run", "test:smoke"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production BIND_HOST=0.0.0.0 APP_PORT=4000
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY prompts ./prompts
COPY mock-samples ./mock-samples
COPY manual-test-samples ./manual-test-samples
COPY tests/catalog.json ./tests/catalog.json
RUN mkdir runtime && chown -R node:node runtime
USER node
EXPOSE 4000
CMD ["node", "dist/apps/backend/main.js"]
