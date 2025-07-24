FROM node:18-slim

# Instalar librerías necesarias para Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Crear carpeta de trabajo
WORKDIR /app

# Copiar package.json y lock
COPY package*.json ./

# Instalar dependencias de Node
RUN npm install

# Copiar resto del código
COPY . .

# Exponer el puerto
EXPOSE 3000

# Iniciar la app
CMD ["node", "index.js"]
