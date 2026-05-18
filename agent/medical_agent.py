import os
import asyncio
import logging
import re
import requests
from dotenv import load_dotenv
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli
from livekit.agents import Agent, AgentSession, llm
from livekit.plugins import openai, silero, cartesia, deepgram

load_dotenv()
logger = logging.getLogger("medical-agent")
logging.basicConfig(level=logging.INFO)

# Allow overriding the Flask backend URL via environment (set FLASK_URL).
# Default to localhost for local development.
FLASK_URL = os.getenv("FLASK_URL", "http://localhost:5001")

# ─── IDENTITY DETECTION ───────────────────────────────────────────────────────
# Outbound calls set identity = patient UUID  (e.g. "1aa72e6-0dc6-469d-a0b2-...")
# Inbound  calls set identity = caller phone  (e.g. "+919847012345")

def _is_phone(identity: str) -> bool:
    """Return True if the identity looks like a phone number rather than a UUID."""
    stripped = identity.replace("+", "").replace(" ", "").replace("-", "")
    # UUIDs are 32 hex chars with dashes; phone numbers are 7-15 digits
    if re.fullmatch(r"[0-9a-f]{8}[0-9a-f]{4}[0-9a-f]{4}[0-9a-f]{4}[0-9a-f]{12}", stripped):
        return False
    return bool(re.search(r"\d{7,15}", stripped))


# ─── PATIENT FETCH ────────────────────────────────────────────────────────────

def fetch_patient_by_id(patient_id: str):
    try:
        res = requests.get(f"{FLASK_URL}/patient/{patient_id}")
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        logger.error(f"fetch_patient_by_id error: {e}")
    return None


def fetch_patient_by_phone(phone: str):
    try:
        # URL-encode the + sign so Flask receives it correctly
        encoded = phone.replace("+", "%2B")
        res = requests.get(f"{FLASK_URL}/patient/by_phone/{encoded}")
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        logger.error(f"fetch_patient_by_phone error: {e}")
    return None


# ─── AGENT TOOL CLASS ─────────────────────────────────────────────────────────

class MedicalAssistant:
    def __init__(self, room, patient_id: str):
        self.room       = room
        self.patient_id = patient_id

    @llm.function_tool(
        description=(
            "Call this IMMEDIATELY after you finish reading the ENTIRE medical report summary. "
            "This marks the report as delivered and prompts you to ask for questions."
        )
    )
    async def report_delivered(self):
        logger.info("Report marked as delivered")
        return "Report delivered. Now ask the patient if they have any questions."

# ─── INSTRUCTIONS BUILDER ─────────────────────────────────────────────────────

def _build_context(patient_data, call_type: str):
    """
    Returns (instructions, initial_greeting) tailored to inbound vs outbound.
    call_type: "inbound" | "outbound"
    """
    if not patient_data:
        # No record found — same message for both call types
        instructions = (
            "You are a medical AI assistant for a healthcare clinic. "
            "The caller's record was not found in our system. "
            "Apologise politely, let them know they may not be registered yet, "
            "and advise them to visit the clinic or call the front desk to register. "
            "Keep your answers brief and professional."
        )
        if call_type == "inbound":
            greeting = (
                "Hello, thank you for calling the medical clinic. "
                "This is your AI assistant. How can I help you today?"
            )
        else:
            greeting = (
                "Hello, this is your AI assistant from the medical clinic. "
                "How can I help you today?"
            )
        return instructions, greeting

    name    = patient_data.get("name", "Patient")
    summary = patient_data.get("summary", "").strip()
    status  = patient_data.get("status", "Pending")

    if not summary or status != "Processed":
        # Patient registered but no report analysed yet
        instructions = (
            f"You are a medical AI assistant calling from the healthcare clinic. "
            f"You are speaking to {name}. "
            f"Their medical report has NOT been uploaded or analysed yet. "
            "YOUR JOB:\n"
            "1. Greet them warmly.\n"
            "2. Inform them that we do not have an analysed report on file for them yet.\n"
            "3. Let them know they can visit the clinic to upload their documents, "
            "or the clinic staff will reach out once their report is ready.\n"
            "4. Ask if there is anything else you can help with.\n"
            "5. When they are done, say 'Goodbye and take care' and call `end_call`."
        )
        if call_type == "inbound":
            greeting = (
                f"Hello {name}, thank you for calling the medical clinic. "
                "I'm your AI assistant. I'll be happy to help you today."
            )
        else:
            greeting = (
                f"Hello {name}, this is your AI assistant from the medical clinic. "
                "I'm calling regarding your medical report."
            )
        return instructions, greeting

    # Full report available
    if call_type == "inbound":
        instructions = (
            f"You are a medical AI assistant at the healthcare clinic. "
            f"The patient calling you is {name}. "
            f"Here is their analysed medical report summary:\n{summary}\n\n"
            "YOUR JOB:\n"
            "1. The patient is calling in — greet them and ask how you can help.\n"
            "2. When they ask about their report or results, read out the ENTIRE summary "
            "clearly and compassionately in one continuous flow.\n"
            "3. After finishing, ask if they have any questions.\n"
            "4. Answer brief follow-up questions. NEVER diagnose or prescribe — "
            "always recommend they follow up with their doctor.\n"
            "5. When they are done, say 'Goodbye and take care' and call `end_call`."
        )
        greeting = (
            f"Hello {name}, thank you for calling the medical clinic. "
            "I'm your AI assistant. How can I help you today?"
        )
    else:
        # Outbound — clinic calling patient
        instructions = (
            f"You are a medical AI assistant calling from the healthcare clinic. "
    f"You are speaking to {name}. "
    f"Here is their recent medical report summary:\n{summary}\n\n"
    "STRICT STEP BY STEP — follow EXACTLY in this order:\n"
    "STEP 1: Wait for the patient to speak.\n"
    "STEP 2: When patient says anything like 'ready', 'yes', 'ok', 'go ahead' — "
    "immediately read the ENTIRE summary in one continuous flow. "
    "Do NOT stop mid-report. Do NOT ask questions mid-report.\n"
    "STEP 3: After finishing the full summary, call report_delivered() tool.\n"
    "STEP 4: Ask 'Do you have any questions about your report?'\n"
    "STEP 5: Answer any questions briefly. NEVER diagnose or prescribe.\n"
    "STEP 6: When patient is done, say 'Goodbye and take care'.\n\n"
    "FORBIDDEN: NEVER call report_delivered() before reading the full summary.\n"
    "FORBIDDEN: NEVER skip reading the summary when patient says ready.\n"

        )
        greeting = (
            f"Hello {name}, this is your AI assistant from the medical clinic. "
            "I have the results of your recent report. Let me know when you're ready to hear them."
        )

    return instructions, greeting


# ─── ENTRYPOINT ───────────────────────────────────────────────────────────────

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info(f"Room joined: {ctx.room.name}")

    participant = await ctx.wait_for_participant()
    identity    = participant.identity
    logger.info(f"Participant identity: {identity}")

    # ── Detect call direction and fetch patient ────────────────────────────────
    if _is_phone(identity):
        call_type   = "inbound"
        patient_id  = identity          # store phone as reference for call_end
        logger.info(f"INBOUND call from phone: {identity}")
        patient_data = fetch_patient_by_phone(identity)
    try:
        requests.post(f"{FLASK_URL}/log_inbound_call", json={"phone": identity})
        logger.info(f"Inbound call logged for {identity}")
    except Exception as e:
        logger.error(f"Failed to log inbound call: {e}")
    else:
        call_type   = "outbound"
        patient_id  = identity          # UUID
        logger.info(f"OUTBOUND call for patient_id: {identity}")
        patient_data = fetch_patient_by_id(identity)

    if patient_data:
        logger.info(f"Patient found: {patient_data.get('name')} | status: {patient_data.get('status')}")
    else:
        logger.warning("No patient record found for this caller")

    # ── Build instructions and greeting ───────────────────────────────────────
    instructions, initial_greeting = _build_context(patient_data, call_type)

    assistant = MedicalAssistant(ctx.room, patient_id)

    # ── Create session ─────────────────────────────────────────────────────────
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(
            api_key=os.getenv("DEEPGRAM_API_KEY"),
            model="nova-2",
            language="en-US",
            smart_format=True,
            interim_results=False,
        ),
        llm=openai.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            model="meta-llama/llama-4-scout-17b-16e-instruct",
        ),
        tts=cartesia.TTS(
            api_key=os.getenv("CARTESIA_API_KEY"),
            model="sonic-english",
            voice="248be419-c632-4f23-adf1-5324ed7dbf1d",
            language="en",
        ),
    )

    await session.start(
        agent=Agent(
            instructions=instructions,
            tools=llm.find_function_tools(assistant),
        ),
        room=ctx.room,
    )
    logger.info(f"AgentSession started ({call_type})")

    await session.generate_reply(
        instructions=f"Greet the caller with exactly this: {initial_greeting}"
    )
    logger.info("Greeting sent")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        agent_name="Aleena",
    ))