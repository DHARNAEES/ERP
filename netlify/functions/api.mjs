import express from 'express';
import serverless from 'serverless-http';

// Netlify has no persistent disk: the SQLite file lives in /tmp and is re-seeded
// whenever the function starts cold, so demo data resets after idle periods.
process.env.PEOPLEHUB_DB ??= '/tmp/peoplehub.db';
const { default: api } = await import('../../server/app.js');

// The routes are mounted under /api; map the function URL back onto them.
const app = express();
app.use((req, _res, next) => {
  req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '');
  if (!req.url.startsWith('/api')) req.url = `/api${req.url}`;
  next();
});
app.use(api);

export const handler = serverless(app);
