FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Seed on first boot only if the data file doesn't exist, then start.
CMD ["sh", "-c", "[ -f ./flashrush-data.json ] || npm run seed; npm start"]
