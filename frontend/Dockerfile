# Stage 1: Build the Vue 3 SPA frontend
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY shared ./shared
COPY frontend ./frontend

RUN npm ci
RUN npm run build --workspace=@jobapp/frontend

# Stage 2: Serve static files with Nginx
FROM nginx:alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
