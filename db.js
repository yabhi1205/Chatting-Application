const mongoose = require('mongoose');
require('dotenv/config')
const databaseUri = `mongodb+srv://${process.env.dbUser}:${process.env.dbPass}@realtimechattingapplica.nsykc9x.mongodb.net/?retryWrites=true&w=majority`
const connectToMongo = () => {
    mongoose.connect(databaseUri).then(() => {
        console.log("Connected to Server Successfully...")
    })
}

module.exports = connectToMongo