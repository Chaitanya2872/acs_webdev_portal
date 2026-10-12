FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env.example ./.env.example
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 3000
CMD ["npm", "run", "start"]
