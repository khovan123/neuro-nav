import WebSocket from 'ws';

console.log('=== E2E WebSocket Relay Test ===\n');

// Step 1: Simulate extension connecting
const ext = new WebSocket('ws://127.0.0.1:9500');

ext.on('open', () => {
  ext.send(JSON.stringify({ source: 'extension', type: 'IDENTIFY' }));
  console.log('[mock-ext] ✅ Connected and identified as extension');
});

ext.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === 'CONNECTED') {
    console.log('[mock-ext] ✅ Server acknowledged connection');
    return;
  }

  console.log(`[mock-ext] Received command: ${msg.type}`);

  // Respond to PING
  if (msg.type === 'PING') {
    ext.send(JSON.stringify({
      source: 'extension',
      type: 'RESPONSE',
      requestId: msg.requestId,
      success: true,
      data: 'pong',
    }));
    console.log('[mock-ext] ✅ Sent pong response');
  }
});

// Step 2: After extension connects, run CLI ping via the actual CLI binary
setTimeout(async () => {
  console.log('\n[mock-cli] Connecting as CLI...');
  const cli = new WebSocket('ws://127.0.0.1:9500');

  cli.on('open', () => {
    cli.send(JSON.stringify({ source: 'cli', type: 'IDENTIFY' }));
    console.log('[mock-cli] ✅ Connected and identified as CLI');
  });

  cli.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'CONNECTED') {
      console.log('[mock-cli] ✅ Server acknowledged');
      // Send PING command
      const reqId = 'test-' + Date.now();
      cli.send(JSON.stringify({
        source: 'cli',
        type: 'PING',
        requestId: reqId,
      }));
      console.log(`[mock-cli] Sent PING (requestId: ${reqId})`);
      return;
    }

    if (msg.type === 'RESPONSE') {
      console.log(`\n[mock-cli] ✅ GOT RESPONSE: success=${msg.success}, data="${msg.data}"`);
      console.log('\n=== ✅ E2E Test PASSED — Full relay working! ===\n');
      cli.close();
      ext.close();
      process.exit(0);
    }
  });

  cli.on('error', (err) => {
    console.error('[mock-cli] ❌ Error:', err.message);
    process.exit(1);
  });
}, 1000);

// Failsafe timeout
setTimeout(() => {
  console.error('\n=== ❌ E2E Test FAILED — Timeout after 10s ===\n');
  process.exit(1);
}, 10000);
