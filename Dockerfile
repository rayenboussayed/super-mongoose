FROM node:24.19.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/super-mongoose/package.json ./packages/super-mongoose/package.json
COPY apps/studio/package.json ./apps/studio/package.json

RUN npm install --omit=dev=false

COPY packages/super-mongoose ./packages/super-mongoose
COPY apps/studio ./apps/studio

RUN npm run build -w super-mongoose
RUN npm run build -w @super-mongoose/studio

ENV MONGO_URL="mongodb://host.docker.internal:27018"
ENV MONGO_DB="super_mongoose_studio"
EXPOSE 3010

CMD ["npm", "run", "start", "-w", "apps/studio"]
