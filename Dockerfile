FROM node:20-slim AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
RUN prisma py generate
COPY --from=frontend /fe/dist ./static

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "(prisma db push --accept-data-loss || true) && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
