# ---- Build frontend ----
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Backend ----
FROM node:20-alpine
WORKDIR /app

# Backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Backend source
COPY backend/ ./backend/

# Built frontend from previous stage
COPY --from=frontend-builder /app/frontend/build ./frontend/build

# Electron config (for version info)
COPY package*.json ./

EXPOSE 3001

ENV CHAT_APP_HOST=0.0.0.0
ENV CHAT_APP_PORT=3001
ENV CHAT_APP_DB_PATH=/data/chat.db
ENV CHAT_APP_UPLOADS_PATH=/data/uploads
ENV BACKUP_DIR=/data/backups
ENV NODE_ENV=production

VOLUME ["/data"]

CMD ["node", "backend/server.js"]
