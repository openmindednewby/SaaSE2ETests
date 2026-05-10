FROM mcr.microsoft.com/playwright:v1.48.0-noble
LABEL org.opencontainers.image.authors="dloizides.com"
LABEL org.opencontainers.image.vendor="dloizides.com"
LABEL org.opencontainers.image.title="E2ETests"
LABEL built-by="dloizides.com"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy test files
COPY . .

# Install browsers (Chromium only for faster builds)
RUN npx playwright install --with-deps chromium

# Create reports directory
RUN mkdir -p reports

# Default command - run all tests
CMD ["npx", "playwright", "test", "--reporter=html,json"]
