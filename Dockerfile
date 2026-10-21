# -----------------------------------------------------------------------------
# JEMI DevOps Control Center - Production Dockerfile
# Multi-stage / minimal footprint with unprivileged user for security
# -----------------------------------------------------------------------------
FROM python:3.10-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=5000 \
    FLASK_DEBUG=false

# Create unprivileged application user
RUN groupadd -g 10001 jemi && \
    useradd -u 10001 -g jemi -m -s /bin/bash jemiuser

WORKDIR /app

# Install dependencies using layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application assets and source code
COPY app.py health_service.py ./
COPY templates/ ./templates/
COPY static/ ./static/

# Set file ownership to unprivileged user
RUN chown -R jemiuser:jemi /app

# Switch to non-root user
USER jemiuser

# Expose internal container port
EXPOSE 5000

# Container health probe using Python standard library (no curl required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/api/health', timeout=3)" || exit 1

# Start Flask production application
CMD ["python", "app.py"]
