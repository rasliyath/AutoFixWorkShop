const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');
const { AccessToken, RoomServiceClient, AgentDispatchClient } = require('livekit-server-sdk');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const apiKey    = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Token server on :${PORT}  |  ${httpUrl}`));