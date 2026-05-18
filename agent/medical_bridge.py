import os
import json
import asyncio
import base64
import io
import uuid
import datetime
import PyPDF2
from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv
from livekit import api
from pymongo import MongoClient

load_dotenv()

app = Flask(__name__)
CORS(app)

groq_client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)

MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

mongo_uri = os.getenv("MONGODB_URI")
mongo_client = MongoClient(mongo_uri)
db = mongo_client.get_database()
patients_collection = db["patients"]
calls_collection    = db["calls"]


# ─── PATIENTS ─────────────────────────────────────────────────────────────────

@app.route('/patients', methods=['GET'])
def get_patients():
    patients = list(patients_collection.find({}, {"_id": 0}))
    return jsonify(patients)


@app.route('/patient', methods=['POST'])
def add_patient():
    data   = request.json
    phone  = data.get("phone")
    name   = data.get("name", "Unknown")
    age    = data.get("age", "")
    gender = data.get("gender", "")

    if not phone:
        return jsonify({"error": "Phone required"}), 400

    norm_phone = phone.replace(" ", "+")
    if not norm_phone.startswith("+"):
        norm_phone = "+" + norm_phone.lstrip("+")

    patient_id   = str(uuid.uuid4())
    patient_data = {
        "id":         patient_id,
        "name":       name,
        "age":        age,
        "gender":     gender,
        "phone":      norm_phone,
        "status":     "Pending",
        "history":    "N/A",
        "summary":    "",
        "lastReport": "",
        "callCount":  0,
    }
    patients_collection.insert_one(patient_data)
    del patient_data["_id"]
    return jsonify({"status": "success", "patient": patient_data})


@app.route('/patient/<patient_id>', methods=['GET'])
def get_patient(patient_id):
    patient = patients_collection.find_one({"id": patient_id}, {"_id": 0})
    if patient:
        return jsonify(patient)
    return jsonify({"error": "Patient not found"}), 404


@app.route('/patient/<patient_id>', methods=['DELETE'])
def delete_patient(patient_id):
    result = patients_collection.delete_one({"id": patient_id})
    if result.deleted_count > 0:
        calls_collection.delete_many({"patient_id": patient_id})
        return jsonify({"status": "success"})
    return jsonify({"error": "Patient not found"}), 404


@app.route('/patient/<patient_id>', methods=['PUT'])
def update_patient(patient_id):
    data = request.json
    patient = patients_collection.find_one({"id": patient_id}, {"_id": 0})
    
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    
    update_fields = {}
    if "name" in data:
        update_fields["name"] = data["name"]
    if "age" in data:
        update_fields["age"] = data["age"]
    if "gender" in data:
        update_fields["gender"] = data["gender"]
    if "phone" in data:
        phone = data["phone"]
        norm_phone = phone.replace(" ", "+")
        if not norm_phone.startswith("+"):
            norm_phone = "+" + norm_phone.lstrip("+")
        update_fields["phone"] = norm_phone
    if "status" in data:
        update_fields["status"] = data["status"]
    if "history" in data:
        update_fields["history"] = data["history"]
    
    if not update_fields:
        return jsonify({"error": "No fields to update"}), 400
    
    patients_collection.update_one({"id": patient_id}, {"$set": update_fields})
    updated_patient = patients_collection.find_one({"id": patient_id}, {"_id": 0})
    return jsonify({"status": "success", "patient": updated_patient})


# ─── INBOUND: lookup by phone number ─────────────────────────────────────────

@app.route('/patient/by_phone/<path:phone>', methods=['GET'])
def get_patient_by_phone(phone):
    digits = "".join(c for c in phone if c.isdigit())
    candidates = [
        "+" + digits,
        phone.replace(" ", "+") if phone.startswith("+") else "+" + phone.lstrip("+"),
    ]
    for candidate in candidates:
        patient = patients_collection.find_one({"phone": candidate}, {"_id": 0})
        if patient:
            return jsonify(patient)

    # Last resort: match trailing 10 digits
    suffix  = digits[-10:] if len(digits) >= 10 else digits
    patient = patients_collection.find_one(
        {"phone": {"$regex": f"{suffix}$"}}, {"_id": 0}
    )
    if patient:
        return jsonify(patient)

    return jsonify({"error": "Patient not found"}), 404


# ─── INBOUND CALL LOGGING ────────────────────────────────────────────────────
# Called by medical_agent.py when it detects an inbound call (phone as identity)

@app.route('/log_inbound_call', methods=['POST'])
def log_inbound_call():
    data  = request.json
    phone = data.get("phone")
    if not phone:
        return jsonify({"error": "phone required"}), 400

    # Try to find matching patient
    digits   = "".join(c for c in phone if c.isdigit())
    suffix   = digits[-10:] if len(digits) >= 10 else digits
    patient  = (
        patients_collection.find_one({"phone": "+" + digits}, {"_id": 0}) or
        patients_collection.find_one({"phone": {"$regex": f"{suffix}$"}}, {"_id": 0})
    )

    call_id = str(uuid.uuid4())
    calls_collection.insert_one({
        "call_id":      call_id,
        "patient_id":   patient["id"] if patient else phone,
        "patient_name": patient["name"] if patient else "Unknown Caller",
        "phone":        phone,
        "call_type":    "inbound",
        "started_at":   datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ended_at":     None,
    })
    if patient:
        patients_collection.update_one({"id": patient["id"]}, {"$inc": {"callCount": 1}})

    return jsonify({"status": "success", "call_id": call_id,
                    "patient_name": patient["name"] if patient else "Unknown Caller"})


# ─── ANALYSE REPORT ──────────────────────────────────────────────────────────

@app.route('/analyse', methods=['POST'])
def analyse_report():
    data        = request.json
    patient_id  = data.get("patient_id")
    file_base64 = data.get("file_base64")
    file_type   = data.get("file_type", "image/jpeg")

    if not patient_id or not file_base64:
        return jsonify({"error": "patient_id and file_base64 are required"}), 400

    try:
        if file_type.startswith("image/"):
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analyze this medical report. Extract key findings and provide "
                                "a plain-language summary for the patient. Address the patient "
                                "directly as 'you' or 'your'. Use **Markdown bolding** to highlight "
                                "the MAIN ISSUES or critical findings. E.g., 'Your report shows...'"
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{file_type};base64,{file_base64}"},
                        },
                    ],
                }
            ]

        elif file_type == "application/pdf":
            try:
                pdf_data   = base64.b64decode(file_base64)
                pdf_reader = PyPDF2.PdfReader(io.BytesIO(pdf_data))
                text = ""
                for page in pdf_reader.pages:
                    extracted = page.extract_text()
                    if extracted:
                        text += extracted + "\n"
                if not text.strip():
                    return jsonify({"error": "No extractable text found in the PDF."}), 400
                messages = [
                    {
                        "role": "user",
                        "content": (
                            "Analyze the following text from a medical report. "
                            "Extract key findings and provide a plain-language summary for the patient. "
                            "Address the patient directly as 'you' or 'your'. "
                            "Use **Markdown bolding** to highlight the MAIN ISSUES or critical findings.\n\n"
                            f"Medical Report Text:\n{text}"
                        ),
                    }
                ]
            except Exception as e:
                return jsonify({"error": f"Failed to parse PDF: {str(e)}"}), 400
        else:
            return jsonify({"error": "Only image and PDF formats are supported."}), 400

        print(f"Calling Groq API [{MODEL}]...")
        response = groq_client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=300,
        )
        summary = response.choices[0].message.content.strip()
        print(f"Summary generated: {summary[:80]}...")

        room_name = f"medical-{patient_id}"
        patients_collection.update_one({"id": patient_id}, {"$set": {
            "summary":     summary,
            "status":      "Processed",
            "room":        room_name,
            "lastReport":  datetime.datetime.now().strftime("%Y-%m-%d"),
            "history":     "Report processed",
            "file_base64": file_base64,
            "file_type":   file_type,
        }})

        return jsonify({"status": "success", "summary": summary})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ─── CALLS ────────────────────────────────────────────────────────────────────

@app.route('/calls', methods=['GET'])
def get_calls():
    calls = list(calls_collection.find({}, {"_id": 0}).sort("started_at", -1))
    return jsonify(calls)


@app.route('/call_end/<patient_id>', methods=['POST'])
def call_end(patient_id):
    latest_call = calls_collection.find_one(
        {"patient_id": patient_id, "ended_at": None},
        sort=[("started_at", -1)],
    )
    if latest_call:
        calls_collection.update_one(
            {"call_id": latest_call["call_id"]},
            {"$set": {"ended_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}},
        )
    return jsonify({"status": "success"})


@app.route('/trigger_call', methods=['POST'])
def trigger_call():
    data       = request.json
    patient_id = data.get("patient_id")

    if not patient_id:
        return jsonify({"error": "patient_id required"}), 400

    patient = patients_collection.find_one({"id": patient_id})
    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    phone = patient.get("phone")

    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    call_id = str(uuid.uuid4())
    calls_collection.insert_one({
        "call_id":      call_id,
        "patient_id":   patient_id,
        "patient_name": patient.get("name", "Unknown"),
        "phone":        phone,
        "call_type":    "outbound",
        "started_at":   datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ended_at":     None,
    })

    loop.run_until_complete(trigger_outbound_call(phone, patient_id))
    patients_collection.update_one({"id": patient_id}, {"$inc": {"callCount": 1}})
    return jsonify({"status": "success"})


async def trigger_outbound_call(phone, patient_id):
    sip_trunk_id = os.getenv("SIP_OUTBOUND_TRUNK_ID", "ST_e4nE96GJnKbS")
    livekit_url  = os.getenv("LIVEKIT_URL")
    api_key      = os.getenv("LIVEKIT_API_KEY")
    api_secret   = os.getenv("LIVEKIT_API_SECRET")
    room_name    = f"medical-{patient_id}"

    async with api.LiveKitAPI(livekit_url, api_key, api_secret) as lkapi:
        try:
            await lkapi.room.create_room(api.CreateRoomRequest(name=room_name))
            await lkapi.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(room=room_name, agent_name="Aleena")
            )
            await asyncio.sleep(3)
            await lkapi.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    sip_trunk_id=sip_trunk_id,
                    sip_call_to=phone,
                    room_name=room_name,
                    participant_identity=patient_id,
                    participant_name="Patient",
                    sip_number="+19129334020",
                )
            )
            print(f"Outbound call to {phone} | patient {patient_id}")
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Outbound call failed: {e}")


if __name__ == '__main__':
    app.run(port=5001, debug=True, host='0.0.0.0')