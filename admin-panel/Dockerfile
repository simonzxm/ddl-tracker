FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
# Copy built admin panel to nginx html dir
COPY --from=build /app/dist /usr/share/nginx/html/admin
