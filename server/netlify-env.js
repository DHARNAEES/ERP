// Imported first by the Netlify function so the database path is set before db.js loads.
// Netlify has no persistent disk: the SQLite file lives in /tmp and is re-seeded
// whenever the function starts cold, so demo data resets after idle periods.
process.env.PEOPLEHUB_DB ??= '/tmp/peoplehub.db';
