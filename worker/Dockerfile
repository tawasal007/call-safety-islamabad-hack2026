FROM python:3.12-slim
WORKDIR /app/worker
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-translation.txt ./
RUN pip install --no-cache-dir -r requirements-translation.txt
COPY core.py server.py ./
ENV CALL_LOG_DB=/data/calls.sqlite3
EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
