FROM node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always
RUN npm install -g npm@11.17.0 --no-audit --no-fund --loglevel=error
COPY package*.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always
RUN npm install -g npm@11.17.0 --no-audit --no-fund --loglevel=error
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/apps/api-gateway/src/main.js"]
