# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# Build-time configuration is PUBLIC (ends up in the bundle). Never pass secrets here.
ARG VITE_API_BASE_URL=""
ARG VITE_EXTRA_BASEMAPS=""
ARG VITE_SOURCE_URL=""
ARG VITE_TERRAIN_TILES_URL="https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
ENV VITE_SOURCE_URL=$VITE_SOURCE_URL VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_EXTRA_BASEMAPS=$VITE_EXTRA_BASEMAPS VITE_TERRAIN_TILES_URL=$VITE_TERRAIN_TILES_URL
RUN npm run build && node scripts/check-bundle-secrets.mjs

FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
ENV MOBSIM_API_UPSTREAM=http://api:8000
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
