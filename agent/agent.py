import os
import asyncio
import logging
import json
from dotenv import load_dotenv
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.agents import Agent, AgentSession
from livekit.plugins import openai, silero, deepgram, cartesia
from typing import Annotated

load_dotenv()
logger = logging.getLogger("autofix-agent")
logging.basicConfig(level=logging.INFO)
# Suppress noisy lk.agent.session byte stream warnings (harmless, expected in 1.5.x)
logging.getLogger("root").setLevel(logging.WARNING)
logging.getLogger("livekit.rtc").setLevel(logging.WARNING)


class AutoFixAssistant:
    def __init__(self, room):
        self.room = room
        self.collected_data = {
            "owner_name": None, "phone": None,
            "vehicle_make": None, "vehicle_model": None,
            "year": None, "reg_number": None,
            "issue": None, "urgency": None,
        }
        # Track last published agent text to avoid duplicates
        self._last_agent_text = ""

    async def _publish(self, payload: dict):
        await self.room.local_participant.publish_data(
            json.dumps(payload).encode(), reliable=True
        )

    async def _broadcast_fields(self):
        await self._publish({"type": "data_update", "fields": self.collected_data})
        logger.info(f"[BROADCAST] {self.collected_data}")

    async def publish_agent_msg(self, text: str):
        """Publish agent message, deduplicating against last sent text."""
        text = text.strip()
        if not text or text == self._last_agent_text:
            return
        self._last_agent_text = text
        await self._publish({"type": "agent_msg", "text": text})
        logger.info(f"ALEENA: {text}")

    @llm.function_tool(
        description=(
            "Save one validated field immediately when the caller confirms it. "
            "Call once per field. Never repeat the value back to the caller. "
            "IMPORTANT: Only call this with a genuine non-empty, validated value. "
            "Never call with empty string or placeholder text."
        )
    )
    async def save_info(
        self,
        field: Annotated[str, "Exact field name: owner_name, phone, vehicle_make, vehicle_model, year, reg_number, issue, or urgency"],
        value: Annotated[str, "The validated non-empty value spoken by the caller"],
    ):
        field = field.lower().strip().replace(" ", "_")
        if field not in self.collected_data:
            return f"Unknown field '{field}'. Do not proceed — ask again."

        value = value.strip()
        if not value or len(value) < 2:
            return "Value is empty or too short. Do not save — ask the caller again."

        # Basic per-field validation
        if field == "owner_name":
            # Must look like an actual name: at least 2 words, no digits, not a sentence
            words = value.split()
            REJECT_PHRASES = {"i am ready", "i am here", "hello", "hi", "yes", "no",
                              "okay", "ok", "sure", "ready", "what", "nothing"}
            if len(words) < 2:
                return "Single word is not a full name. Ask for first and last name."
            if value.lower() in REJECT_PHRASES or value.lower().startswith("i am "):
                return f"'{value}' does not look like a name. Ask the caller for their actual full name."
            if any(c.isdigit() for c in value):
                return "Names should not contain numbers. Ask again."

        if field == "year":
            digits = "".join(c for c in value if c.isdigit())
            if not digits or not (1990 <= int(digits[:4]) <= 2026):
                return "Invalid year. Must be between 1990 and 2026. Ask again."
            value = digits[:4]

        if field == "phone":
            digits = "".join(c for c in value if c.isdigit())
            if len(digits) < 7:
                return "Phone number too short. Ask the caller to repeat digit by digit."

        if field == "issue":
            if len(value.split()) < 3:
                return "Issue description too vague. Ask for more detail (sounds, symptoms, warning lights)."

        self.collected_data[field] = value
        await self._broadcast_fields()
        logger.info(f"[SAVED] {field} = {value}")
        return f"Saved {field}. Move to the next question immediately."


import re as _re

# Patterns that indicate a content fragment is a tool call leak, not spoken text
_TOOL_LEAK_RE = _re.compile(
    r'save_info\s*[>=]|<function|"field"\s*:|"value"\s*:|\{.*"field".*\}',
    _re.IGNORECASE | _re.DOTALL
)

def _is_tool_leak(text: str) -> bool:
    """Return True if text contains raw tool-call JSON/XML that should not be shown."""
    return bool(_TOOL_LEAK_RE.search(text))


def _clean_text(text: str) -> str | None:
    """
    Remove any tool-call prefix that sometimes leaks into ChatMessage content.
    e.g. 'owner_name=save_info>{"field":...}</function> Real reply here'
    Returns the clean spoken part, or None if nothing remains.
    """
    # Strip everything up to and including </function> or </tool_call>
    cleaned = _re.sub(r'.*?</(?:function|tool_call)>\s*', '', text, flags=_re.DOTALL)
    if not cleaned:
        cleaned = text
    # If the remainder still looks like a tool call, discard entirely
    if _is_tool_leak(cleaned):
        return None
    cleaned = cleaned.strip()
    return cleaned if cleaned else None


def _extract_content(obj) -> str | None:
    """Extract clean spoken text from content that may be str, list[str], or content parts."""
    if not obj:
        return None
    if isinstance(obj, str):
        return _clean_text(obj)
    if isinstance(obj, list):
        parts = []
        for item in obj:
            raw = None
            if isinstance(item, str):
                raw = item
            elif hasattr(item, "text") and isinstance(item.text, str):
                raw = item.text
            elif hasattr(item, "transcript") and isinstance(item.transcript, str):
                raw = item.transcript
            if raw:
                cleaned = _clean_text(raw)
                if cleaned:
                    parts.append(cleaned)
        text = " ".join(parts)
        return text if text else None
    return None


def _get_text(ev) -> str | None:
    """
    Extract clean spoken text from a livekit-agents event.
    Handles conversation_item_added: ev.item = ChatMessage(content=[...], role="assistant")
    Filters out raw tool-call JSON that sometimes leaks into content strings.
    """
    # Case 1: event wraps an .item (conversation_item_added pattern)
    item = getattr(ev, "item", None)
    if item is not None:
        text = _extract_content(getattr(item, "content", None))
        if text:
            return text
        t = getattr(item, "text", None)
        if t and isinstance(t, str):
            return _clean_text(t)

    # Case 2: event has .content directly
    text = _extract_content(getattr(ev, "content", None))
    if text:
        return text

    # Case 3: simple string attributes
    for attr in ("text", "transcript", "text_content"):
        val = getattr(ev, attr, None)
        if val and isinstance(val, str) and val.strip():
            return _clean_text(val)

    return None


async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info(f"Room joined: {ctx.room.name}")

    participant = await ctx.wait_for_participant()
    logger.info(f"Participant ready: {participant.identity}")

    assistant = AutoFixAssistant(ctx.room)

    # ── Track last user text to deduplicate partial transcripts ───────────────
    last_user_text = {"val": "", "ts": 0}

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(
            api_key=os.getenv("DEEPGRAM_API_KEY"),
            model="nova-2",        # nova-2 is stable across all plugin versions
            language="en-IN",
            smart_format=True,
            interim_results=False, # only emit final transcripts → no partials in chat
        ),
        llm=openai.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            model="meta-llama/llama-4-scout-17b-16e-instruct",  # low token usage — fits free tier limits
        ),
        tts=cartesia.TTS(
            api_key=os.getenv("CARTESIA_API_KEY"),
            model="sonic-english",
            voice="248be419-c632-4f23-adf1-5324ed7dbf1d",
            language="en",
        ),
    )

    # ── User speech → chat bubble (deduplicated) ───────────────────────────────
    @session.on("user_input_transcribed")
    def on_user(ev):
        text = getattr(ev, "transcript", None) or _get_text(ev)
        if not text or text.startswith("<"):
            return

        text = text.strip()
        now = asyncio.get_event_loop().time()

        # Deduplicate: skip if same text within 2 seconds
        if text == last_user_text["val"] and (now - last_user_text["ts"]) < 2.0:
            logger.info(f"[DEDUP] Skipping duplicate user msg: {text}")
            return

        # Skip very short fragments that are likely partials ("my", "and", "let's")
        if len(text.split()) <= 1 and len(text) < 5:
            logger.info(f"[SKIP] Too short to be a real utterance: '{text}'")
            return

        last_user_text["val"] = text
        last_user_text["ts"] = now

        logger.info(f"USER: {text}")
        asyncio.ensure_future(
            assistant._publish({"type": "user_msg", "text": text})
        )

    # ── Agent speech → chat bubble ─────────────────────────────────────────────
    # conversation_item_added fires reliably in 1.5.x with ev.item = ChatMessage
    # Using only this event avoids the duplicates from other fallback handlers.
    @session.on("conversation_item_added")
    def on_conv_item(ev):
        item = getattr(ev, "item", None)
        if item is None:
            return
        # Skip non-message items (e.g. AgentHandoff has type="agent_handoff")
        item_type = getattr(item, "type", "")
        if item_type and item_type != "message":
            return
        # Only handle assistant messages
        role = getattr(item, "role", None)
        if role != "assistant":
            return
        text = _get_text(ev)
        if text:
            asyncio.ensure_future(assistant.publish_agent_msg(text))

    @session.on("agent_state_changed")
    def on_state(ev):
        logger.info(f"STATE: {getattr(ev, 'new_state', ev)}")

    # ── Start session ──────────────────────────────────────────────────────────
    INSTRUCTIONS = (
        "You are Aleena, a friendly female AI receptionist for AutoFix Workshop, "
        "a car repair centre in Kerala, India.\n\n"
        "YOUR ONLY JOB: Collect exactly 8 fields by asking ONE short question at a time, in order.\n\n"
        "FIELD ORDER (collect STRICTLY in this sequence):\n"
        "  1. owner_name    - caller's full name (must be 2+ words)\n"
        "  2. phone         - contact number (must have 7+ digits)\n"
        "  3. vehicle_make  - car brand (e.g. Toyota, Honda)\n"
        "  4. vehicle_model - model name (e.g. Innova, City)\n"
        "  5. year          - manufacturing year (1990-2026)\n"
        "  6. reg_number    - registration plate (e.g. KL 07 AB 1234)\n"
        "  7. issue         - problem description (must be 3+ words)\n"
        "  8. urgency       - ONLY accept: High (breakdown) or Normal (drivable)\n\n"
        "VALIDATION RULES - NEVER proceed to next field until current one passes:\n"
        "  - owner_name: Reject single words. Ask for their full name.\n"
        "  - phone: Reject if fewer than 7 digits. Ask to repeat digit by digit.\n"
        "  - year: Reject anything outside 1990-2026 or non-numeric.\n"
        "  - issue: Reject vague words like noise or problem. Ask for more detail.\n"
        "  - urgency: Only accept High or Normal. Otherwise ask: Is the car drivable?\n"
        "  - ALL fields: If caller says skip, don't know, or gives no answer - re-ask. NEVER skip.\n\n"
        "STRICT SPEAKING RULES:\n"
        "  - One sentence per reply, short and conversational.\n"
        "  - Call save_info() silently right after each valid answer.\n"
        "  - NEVER repeat the value back to the caller.\n"
        "  - After saving, immediately ask the next question.\n"
        "  - If save_info() returns an error, re-ask that same field immediately.\n"
        "  - NEVER output tool call syntax, JSON, XML, or function names in your spoken reply.\n"
        "  - Your spoken reply must contain ONLY natural language — no code, no brackets, no braces.\n\n"
        "START: Ask the caller for their full name immediately.\n"
        "CRITICAL: The mechanic name Ravi Kumar is NOT the caller's name. \n"
        "Never save a name from the appointment slot as owner_name.\n\n"
        "AFTER ALL 8 FIELDS ARE SAVED:\n"
        "Offer the slot: I have an opening on Monday 12th May at 9 AM with our mechanic. Shall I confirm?\n"
        "After confirm: Done! You will receive an SMS shortly. Is there anything else?"
    )

    # session.start() in livekit-agents 1.5.x only takes agent= and room=
    await session.start(
        agent=Agent(
            instructions=INSTRUCTIONS,
            tools=llm.find_function_tools(assistant),
        ),
        room=ctx.room,
    )

    # generate_reply triggers the agent to speak AND fires conversation_item_added
    # which will publish the message to chat — so we do NOT manually publish here
    await session.generate_reply(
        instructions=(
            "Greet the caller with exactly this: "
            "Hi! Thank you for calling AutoFix Workshop. "
            "I am Aleena, your AI assistant. May I know your full name please? "
            "Do NOT mention any mechanic names or appointment slots in the greeting."
        )
    )
    logger.info("Greeting sent.")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="Aleena"))