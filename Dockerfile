# Portable image for the Roznama API — works on Render, Railway, Fly.io, Cloud
# Run, or any VPS. Build context must be web/backend (so data/ is included).
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY data ./data
# Hosts inject PORT; default to 8080 locally.
EXPOSE 8080
CMD ["node", "dist/index.js"]
