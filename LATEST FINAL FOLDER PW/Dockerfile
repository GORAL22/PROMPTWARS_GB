FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN addgroup -S graphis && adduser -S graphis -G graphis \
  && chown -R graphis:graphis /app

USER graphis
EXPOSE 8080

CMD ["node", "server.js"]
