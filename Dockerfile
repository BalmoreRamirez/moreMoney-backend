FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Instala todo (incluyendo devDependencies) para tener sequelize-cli disponible
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
