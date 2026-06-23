FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# The app seeds itself safely on first boot (guarded by a marker file on the
# persistent disk), so the container simply starts the server. Never force-seed here.
CMD ["npm", "start"]
