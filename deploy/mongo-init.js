// Runs once, on an empty data volume. Creates the least-privileged user the
// app connects as: read/write on the Morbin database and nothing else.
const dbName = process.env.MORBIN_DB || "morbin";
db.getSiblingDB(dbName).createUser({
  user: process.env.MONGO_APP_USER,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: dbName }],
});
