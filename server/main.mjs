import { createHub } from './app.mjs';
const port = Number(process.env.PORT || 3080),
  host = process.env.HOST || '127.0.0.1';
const app = createHub({
  dir: process.env.DATA_DIR || './var',
  origin: process.env.PUBLIC_URL || `http://${host}:${port}`,
  installationId: process.env.INSTALLATION_ID || ''
});
app.server.listen(port, host, () => console.log(`Gen-hub listening on ${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    app.server.close(() => {
      app.store.close();
      process.exit(0);
    })
  );
