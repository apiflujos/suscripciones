FROM node:20-alpine

WORKDIR /app

COPY . .

WORKDIR /app/apps/admin
RUN npm install --legacy-peer-deps
RUN npm run build

EXPOSE 3002

ENV NODE_ENV=production
CMD ["npm", "run", "start"]
