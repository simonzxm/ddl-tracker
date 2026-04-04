FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Final stage: just copy built files to the volume mount point and exit
FROM alpine:3.20
COPY --from=build /app/dist /dist
CMD ["cp", "-r", "/dist/.", "/output/"]
