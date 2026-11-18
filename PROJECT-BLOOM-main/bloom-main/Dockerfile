# Bloom as a single web service: builds the React site, then runs FastAPI,
# which serves both the site and the API.

# ---- 1. Build the website ----
FROM node:20-slim AS web
WORKDIR /web
# package.json and the postinstall script first (postinstall copies MediaPipe files)
COPY frontend/package.json ./
COPY frontend/scripts ./scripts
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

# ---- 2. Run the server ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BLOOM_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY backend/requirements.txt backend/requirements-postgres.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-postgres.txt
COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist
EXPOSE 8000
# Render (and most hosts) tell the app which port to use through $PORT.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
