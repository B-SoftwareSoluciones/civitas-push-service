FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets

ENV NODE_ENV=production
ENV PORT=8790
EXPOSE 8790

CMD ["npm", "start"]
