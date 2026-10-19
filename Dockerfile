FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets

RUN useradd --uid 10001 --user-group --create-home appuser \
  && mkdir -p /app/data \
  && chown -R appuser:appuser /app

ENV NODE_ENV=production
ENV PORT=8790
EXPOSE 8790

USER appuser

CMD ["npm", "start"]
