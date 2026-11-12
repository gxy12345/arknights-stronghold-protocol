FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry="${NPM_REGISTRY}" \
    || { status=$?; cat /root/.npm/_logs/*-debug-0.log; exit "$status"; }
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.js"]
