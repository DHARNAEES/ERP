import '../../server/netlify-env.js';
import express from 'express';
import serverless from 'serverless-http';
import api from '../../server/app.js';

// The routes are mounted under /api; map the function URL back onto them.
const app = express();
app.use((req, _res, next) => {
  req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '');
  if (!req.url.startsWith('/api')) req.url = `/api${req.url}`;
  next();
});
app.use(api);

export const handler = serverless(app);
