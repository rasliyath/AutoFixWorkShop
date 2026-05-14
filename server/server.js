const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');
const { AccessToken, RoomServiceClient, AgentDispatchClient } = require('livekit-server-sdk');

dotenv.config();

const app = express();
app.use(cors({
  origin: ["https://autofixworkshop.onrender.com", "http://localhost:5173"],
  credentials: true
}));
app.use(express.json());

const apiKey    = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
// const httpUrl   = process.env.LIVEKIT_URL || 'http://10.10.12.237:7881';
const httpUrl   = (process.env.LIVEKIT_URL || '')
  .replace('wss://', 'https://')
  .replace('ws://',  'http://');

const roomSvc     = new RoomServiceClient(httpUrl, apiKey, apiSecret);
const dispatchSvc = new AgentDispatchClient(httpUrl, apiKey, apiSecret);

const sleep = ms => new Promise(r => setTimeout(r, ms));

app.get('/getToken', async (req, res) => {
  // identity comes from the query string, e.g. ?room=xxx&identity=user-123
  const { room, identity } = req.query;   // same as: const identity = req.query.identity
  if (!room || !identity) return res.status(400).json({ error: 'Missing room or identity' });

  try {
    // Step 1: Cancel all existing agent dispatches for this room
    try {
      const dispatches = await dispatchSvc.listDispatches(room);
      console.log(`[dispatch] Found ${dispatches?.length || 0} existing dispatch(es)`);
      for (const d of (dispatches || [])) {
        await dispatchSvc.deleteDispatch(d.dispatchId || d.id, room);
        console.log(`[dispatch] Cancelled: ${d.dispatchId || d.id}`);
      }
    } catch (e) {
      console.log(`[dispatch] List/cancel skipped: ${e.message}`);
    }

    // Step 2: Delete the room — evicts ALL ghost participants including old Aleena
    try {
      await roomSvc.deleteRoom(room);
      console.log(`[room] Deleted: ${room}`);
    } catch (e) {
      console.log(`[room] Delete skipped: ${e.message}`);
    }

    // Step 3: Wait for LiveKit cloud to finish cleanup
    await sleep(5000);

    // Step 4: Generate fresh user token and send it to the client immediately
    const at = new AccessToken(apiKey, apiSecret, { identity });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();

    // Respond to the client first so they can start joining the room
    res.json({ token });

    // Step 5: Dispatch exactly ONE agent AFTER a delay, so the user
    // has time to connect to the room before the agent looks for them.
    // This prevents the "no participant found → retry → double agent" bug.
    setTimeout(async () => {
      try {
        const dispatch = await dispatchSvc.createDispatch(room, 'Aleena');
        console.log(`[dispatch] Created: ${dispatch.dispatchId || dispatch.id}`);
      } catch (e) {
        console.error(`[dispatch] Failed: ${e.message}`);
      }
    }, 3000); // 3s gives the frontend time to join before agent dispatches

  } catch (err) {
    console.error('[getToken] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/startPhoneCall', async (req, res) => {
  try {
    // Cancel all existing agent dispatches for this room
    try {
      const dispatches = await dispatchSvc.listDispatches('autofix-receptionist-room');
      console.log(`[phone-dispatch] Found ${dispatches?.length || 0} existing dispatch(es)`);
      for (const d of (dispatches || [])) {
        await dispatchSvc.deleteDispatch(d.dispatchId || d.id, 'autofix-receptionist-room');
        console.log(`[phone-dispatch] Cancelled: ${d.dispatchId || d.id}`);
      }
    } catch (e) {
      console.log(`[phone-dispatch] List/cancel skipped: ${e.message}`);
    }

    // Delete the room
    try {
      await roomSvc.deleteRoom('autofix-receptionist-room');
      console.log(`[phone-room] Deleted: autofix-receptionist-room`);
    } catch (e) {
      console.log(`[phone-room] Delete skipped: ${e.message}`);
    }

    // Wait for cleanup
    await sleep(5000);

    // Dispatch exactly ONE agent
    setTimeout(async () => {
      try {
        const dispatch = await dispatchSvc.createDispatch('autofix-receptionist-room', 'Aleena');
        console.log(`[phone-dispatch] Created: ${dispatch.dispatchId || dispatch.id}`);
      } catch (e) {
        console.error(`[phone-dispatch] Failed: ${e.message}`);
      }
    }, 3000);

    res.json({ message: 'Agent dispatched for phone call' });
  } catch (err) {
    console.error('[startPhoneCall] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Token server on :${PORT}  |  ${httpUrl}`));