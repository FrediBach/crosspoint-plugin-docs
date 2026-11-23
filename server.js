// Local development server: node server.js  (PORT=3000 by default)
import http from 'node:http';
import handler from './lib/app.js';

const port = Number(process.env.PORT) || 3000;
http.createServer(handler).listen(port, () => {
  console.log(`Plugin Docs on http://localhost:${port}/  (reader catalog: /cat/index.xml)`);
});
