# Use the official Node.js image from the Docker Hub
FROM node:14

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy the rest of your application code
COPY . .

# Install GCC and other build tools
RUN apt-get update && \
    apt-get install -y build-essential

# Expose the port your app runs on
EXPOSE 3000

# Command to run your app
CMD ["npm", "start"]