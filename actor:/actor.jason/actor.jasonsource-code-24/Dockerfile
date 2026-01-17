# Dockerfile
# Playwright-capable base image (Chromium)
FROM apify/actor-node-playwright-chrome:latest

# Copy dependency manifests
COPY --chown=myuser:myuser package.json ./

# Install production deps WITHOUT requiring a lockfile
RUN npm install --omit=dev

# Copy source
COPY --chown=myuser:myuser . ./

# Run the actor
CMD npm start