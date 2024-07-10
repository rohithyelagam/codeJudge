FROM node:14

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --only=production

COPY . .

RUN apt-get update && \
    apt-get install -y build-essential

RUN apt-get install coreutils

EXPOSE 3000

# Command to run your app
CMD ["npm", "start"]