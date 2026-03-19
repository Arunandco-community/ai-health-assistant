FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only torch FIRST (prevents sentence-transformers from pulling full CUDA torch ~2GB)
RUN pip install --no-cache-dir torch==2.2.2+cpu --index-url https://download.pytorch.org/whl/cpu

# Copy and install remaining requirements (torch already satisfied, won't re-download)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download sentence-transformer model during BUILD (not at runtime)
# Avoids downloading 90MB on first request and reduces startup memory spike
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Copy all app code and model files
COPY . .

# Expose port
EXPOSE 8000

# Start FastAPI with 1 worker to minimize memory usage on free tier
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
" " 
