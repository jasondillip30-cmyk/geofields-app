FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY services/receipt-extractor ./services/receipt-extractor

RUN npm install --save-dev typescript tsx @types/node && \
  npx tsc -p services/receipt-extractor/tsconfig.json && \
  npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=4300

EXPOSE 4300
CMD ["node", "services/receipt-extractor/dist/server.js"]
