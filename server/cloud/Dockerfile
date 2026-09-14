FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server/cloud ./server/cloud
COPY server/partner/activity.ts server/partner/sessions.ts ./server/partner/
EXPOSE 8080
USER node
CMD ["node", "--import", "tsx", "server/cloud/runtime.ts"]
