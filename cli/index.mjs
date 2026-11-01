#!/usr/bin/env node
// React chooses its renderer at import time. Its development renderer records
// every animated repaint in Node's unbounded User Timing buffer, even when idle.
// Keep all React/Ink imports behind this bootstrap; development is opt-in.
process.env.NODE_ENV ||= 'production';
await import('./main.mjs');
