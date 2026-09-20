FROM node:20-alpine
WORKDIR /app

RUN addgroup -g 1001 -S app && adduser -S app -u 1001 -G app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
RUN mkdir -p uploads && chown -R app:app /app

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
