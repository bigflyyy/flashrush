import { WebSocketServer } from 'ws';
import { verifyToken } from '../lib/auth.js';

// Simple topic-based pub/sub over WebSockets.
// Clients connect to ws://host/ws?token=JWT and send:
//   { type: 'subscribe', topic: 'order:42' }
//   { type: 'unsubscribe', topic: 'order:42' }
// Server pushes:
//   { type: 'event', topic, event, data }

const topics = new Map(); // topic -> Set<ws>

function subscribe(ws, topic) {
  if (!topics.has(topic)) topics.set(topic, new Set());
  topics.get(topic).add(ws);
  ws._topics.add(topic);
}

function unsubscribe(ws, topic) {
  topics.get(topic)?.delete(ws);
  ws._topics.delete(topic);
}

function cleanup(ws) {
  for (const topic of ws._topics) topics.get(topic)?.delete(ws);
  ws._topics.clear();
}

// Public: emit an event to everyone subscribed to a topic.
export function publish(topic, event, data) {
  const subs = topics.get(topic);
  if (!subs) return;
  const msg = JSON.stringify({ type: 'event', topic, event, data });
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const user = token ? verifyToken(token) : null;
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    ws._user = user;
    ws._topics = new Set();
    ws.send(JSON.stringify({ type: 'connected', user: { id: user.id, role: user.role } }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'subscribe' && msg.topic) subscribe(ws, msg.topic);
      else if (msg.type === 'unsubscribe' && msg.topic) unsubscribe(ws, msg.topic);
      else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    });

    ws.on('close', () => cleanup(ws));
    ws.on('error', () => cleanup(ws));
  });

  // Heartbeat to drop dead connections.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  console.log('  ✓ Real-time WebSocket hub on /ws');
  return wss;
}
