FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
COPY skus.json ./

RUN npm run build

ENV NODE_ENV=production
ENV HEADLESS=true

CMD ["node", "dist/scraper.js"]
