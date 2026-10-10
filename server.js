import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  BROADCAST_PASSWORD,
  ALLOWED_ORIGIN = '*',
  ROOM_NAME = 'radio-room',
} = process.env;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !BROADCAST_PASSWORD) {
  console.error('Missing LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, or BROADCAST_PASSWORD.');
  process.exit(1);
}

// Use a specific website origin in production; '*' is convenient only for local testing.
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',').map(s => s.trim()) }));

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Basic status check: the broadcaster identity must be connected to the room.
app.get('/status', async (_req, res) => {
  try {
    const participants = await roomService.listParticipants(ROOM_NAME);
    const live = participants.some(p => p.identity === 'radio-broadcaster');
    res.set('Cache-Control', 'no-store').json({ live, room: ROOM_NAME });
  } catch (error) {
    console.error('Status check failed:', error.message);
    res.status(503).json({ live: false, error: 'status_unavailable' });
  }
});

app.post('/token', async (req, res) => {
  const role = req.body?.role;
  if (role !== 'listener' && role !== 'broadcaster') {
    return res.status(400).json({ error: 'role must be listener or broadcaster' });
  }

  // Only the holder of the broadcaster password can get publish permission.
  if (role === 'broadcaster' && req.get('x-broadcast-password') !== BROADCAST_PASSWORD) {
    return res.status(401).json({ error: 'invalid_broadcast_password' });
  }

  try {
    const identity = role === 'broadcaster'
      ? 'radio-broadcaster'
      : `listener-${crypto.randomUUID()}`;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      ttl: '15m',
    });
    token.addGrant({
      roomJoin: true,
      room: ROOM_NAME,
      canPublish: role === 'broadcaster',
      canSubscribe: role === 'listener',
      canPublishData: false,
    });

    res.set('Cache-Control', 'no-store').json({
      serverUrl: LIVEKIT_URL,
      token: await token.toJwt(),
      room: ROOM_NAME,
      role,
    });
  } catch (error) {
    console.error('Token creation failed:', error.message);
    res.status(500).json({ error: 'token_creation_failed' });
  }
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Live Audio API listening on port ${PORT}`);
});
