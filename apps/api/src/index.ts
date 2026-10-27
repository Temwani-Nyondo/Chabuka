import express from 'express';

// Day 1 skeleton: the action layer (/api/actions/*, /api/helper, /mcp)
// lands on Day 2. This only proves the app boots and deploys.
const app = express();
const port = Number(process.env.PORT ?? 3001);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'chabuka-api' });
});

app.listen(port, () => {
  console.log(`chabuka api listening on ${port}`);
});
