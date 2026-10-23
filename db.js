const mongoose = require('mongoose');

const connectToMongo = async () => {
  const databaseUri = process.env.MONGODB_URI || (process.env.dbUser && process.env.dbPass
    ? `mongodb+srv://${encodeURIComponent(process.env.dbUser)}:${encodeURIComponent(process.env.dbPass)}@realtimechattingapplica.nsykc9x.mongodb.net/?retryWrites=true&w=majority`
    : null);
  if (!databaseUri) throw new Error('Set MONGODB_URI (or dbUser and dbPass) in your environment.');
  await mongoose.connect(databaseUri, { serverSelectionTimeoutMS: 8000 });
  console.log('Connected to MongoDB.');
};

module.exports = connectToMongo;
