FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements-cloud.txt ./
RUN python -m pip install --no-cache-dir -r requirements-cloud.txt

RUN useradd --create-home --uid 10001 contactia
COPY --chown=contactia:contactia agent.py ./
USER contactia

CMD ["python", "agent.py", "start"]
