import http from 'node:http';
const request = http.get('http://127.0.0.1:3080/healthz', { timeout: 4000 }, response => {
  let body = '';
  response.on('data', chunk => (body += chunk));
  response.on('end', () => {
    try {
      const state = JSON.parse(body);
      process.exit(
        response.statusCode === 200 &&
          state.ok &&
          state.installationId === (process.env.INSTALLATION_ID || '')
          ? 0
          : 1
      );
    } catch {
      process.exit(1);
    }
  });
});
request.on('timeout', () => request.destroy());
request.on('error', () => process.exit(1));
