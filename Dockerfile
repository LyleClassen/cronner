# Use an official Node.js runtime as a parent image
FROM node:lts-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Install tzdata to change the timezone
RUN apk add --no-cache tzdata

# Set the timezone
ENV TZ=Africa/Johannesburg

# Copy package.json and package-lock.json
COPY package*.json ./

# Install project dependencies
RUN npm install

# Bundle app source inside Docker image
COPY . .

# Build the application
RUN npm run build

# Your app binds to port 3000, so use the EXPOSE instruction to have it mapped by the docker daemon
EXPOSE 3000

# Define the command to run the app
CMD ["node", "dist/main"]