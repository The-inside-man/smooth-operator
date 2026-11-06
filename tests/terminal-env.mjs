// Import this before React/Ink in synthetic-terminal tests and fixtures.
// Ink caches CI detection during module evaluation and otherwise buffers live
// frames until unmount. These fixtures intentionally emulate an interactive TTY.
delete process.env.CI;
delete process.env.CONTINUOUS_INTEGRATION;
