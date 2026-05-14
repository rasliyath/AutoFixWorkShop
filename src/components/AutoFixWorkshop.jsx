import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import {
  User, Clock, MessageSquare, Wrench, Power, Trash2, Mic
} from "lucide-react";
import {
  LiveKitRoom,
  useLocalParticipant,
  useRoomContext,
  RoomAudioRenderer,
} from "@livekit/components-react";
import "./AutoFixWorkshop.css";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "wss://autofix-workshop-yol0lzz9.livekit.cloud";
const TOKEN_SERVER_URL = `${import.meta.env.VITE_API_URL}/getToken`;
const PHONE_CALL_URL = `${import.meta.env.VITE_API_URL}/startPhoneCall`;
const TWILIO_NUMBER = import.meta.env.VITE_TWILIO_NUMBER || "+19129334020";

const SLOTS = [
  { time: "9:00 AM", date: "Mon, 12 May", mechanic: "Ravi Kumar" },
  { time: "11:30 AM", date: "Mon, 12 May", mechanic: "Suresh Nair" },
  { time: "2:00 PM", date: "Tue, 13 May", mechanic: "Ajith Menon" },
  { time: "4:00 PM", date: "Tue, 13 May", mechanic: "Ravi Kumar" },
];

const MOCK_ANSWERS = {
  owner_name: "Arjun Pillai",
  phone: "+91 98470 12345",
  vehicle_make: "Toyota",
  vehicle_model: "Innova Crysta",
  year: "2021",
  reg_number: "KL 07 AB 4512",
  issue: "Engine making a knocking sound and check engine light is on",
  urgency: "Normal",
  appointment: "Monday 9:00 AM"
};

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function nowStr() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── DEDUP HELPER ─────────────────────────────────────────────────────────────
// Returns a stable key for a message to detect duplicates
function msgKey(role, text) {
  // Normalise whitespace, lowercase for comparison
  return `${role}::${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

// ─── LIVEKIT HANDLER ──────────────────────────────────────────────────────────
function LiveKitHandler({ setMessages, setFieldMap, logAction, setAppointment,
  setIsUrgent, setSmsAlert, setCallerName }) {

  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  // Keep a rolling window of recently seen message keys to deduplicate
  const recentKeys = useRef(new Set());
  // Only set callerName once — the first real name we receive wins
  const callerNameSet = useRef(false);

  const addMsg = useCallback((role, text) => {
    const raw = text?.trim();
    if (!raw) return;

    const key = msgKey(role, raw);

    // Reject if we've seen this exact message in the last 3 seconds
    if (recentKeys.current.has(key)) return;
    recentKeys.current.add(key);
    setTimeout(() => recentKeys.current.delete(key), 3000);

    // Also reject very short fragments that are clearly partials
    if (role === "user" && raw.split(" ").length <= 1 && raw.length < 5) return;

    setMessages(prev => [...prev, { role, text: raw, time: nowStr() }]);
  }, [setMessages]);

  useEffect(() => {
    // Only use the raw identity (e.g. "user-2483") as a temporary placeholder
    // It will be replaced when owner_name arrives from the agent
    if (localParticipant?.identity && !callerNameSet.current) {
      setCallerName(localParticipant.identity);
    }
  }, [localParticipant, setCallerName]);

  useEffect(() => {
    if (!room) return;

    const handleData = (payload) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));

        if (data.type === "user_msg" && data.text?.trim()) {
          addMsg("user", data.text);
        }

        if (data.type === "agent_msg" && data.text?.trim()) {
          addMsg("agent", data.text);
        }

        if (data.type === "data_update") {
          const incoming = {};
          Object.entries(data.fields).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== "") {
              incoming[k] = { value: v, confirmed: true };
            }
          });
          if (Object.keys(incoming).length > 0) {
            setFieldMap(prev => {
              const updated = { ...prev };
              let changed = false;
              Object.entries(incoming).forEach(([k, v]) => {
                if (!prev[k] || prev[k].value !== v.value) {
                  updated[k] = v;
                  changed = true;
                  logAction(`Saved: ${k} = ${v.value}`);
                }
              });
              return changed ? updated : prev;
            });
            if (incoming.owner_name?.value && !callerNameSet.current) {
              callerNameSet.current = true;
              setCallerName(incoming.owner_name.value);
            }
          }
        }

        if (data.type === "appointment_booked") {
          setAppointment(data.data);
          logAction("Appointment confirmed");
        }

        if (data.type === "urgent_escalation") {
          setIsUrgent(true);
          setSmsAlert({ to: "On-call Mechanic", body: data.details });
          logAction("Urgent escalation triggered");
        }

      } catch (e) {
        console.error("[DataReceived]", e);
      }
    };

    room.on("dataReceived", handleData);
    return () => room.off("dataReceived", handleData);
  }, [room, addMsg, logAction, setFieldMap, setAppointment, setIsUrgent, setSmsAlert, setCallerName]);

  return <RoomAudioRenderer />;
}

// ─── SIMULATION HANDLER ───────────────────────────────────────────────────────
function SimulationHandler({ setMessages, setFieldMap, logAction, setAppointment,
  setSmsAlert, setCallerName }) {

  useEffect(() => {
    setCallerName("Arjun Pillai");

    const conversation = [
      { role: "agent", text: "Hi! Thank you for calling AutoFix Workshop. I'm Aleena, your AI assistant. May I know your full name please?", delay: 500 },
      { role: "user",  text: "My name is Arjun Pillai", delay: 3500, setsField: { key: "owner_name", value: "Arjun Pillai" } },
      { role: "agent", text: "What's your best contact number?", delay: 1500 },
      { role: "user",  text: "+91 98470 12345", delay: 3000, setsField: { key: "phone", value: "+91 98470 12345" } },
      { role: "agent", text: "And what make is your vehicle?", delay: 1500 },
      { role: "user",  text: "Toyota", delay: 2500, setsField: { key: "vehicle_make", value: "Toyota" } },
      { role: "agent", text: "Great — and the model?", delay: 1500 },
      { role: "user",  text: "Innova Crysta", delay: 2500, setsField: { key: "vehicle_model", value: "Innova Crysta" } },
      { role: "agent", text: "What year was it manufactured?", delay: 1500 },
      { role: "user",  text: "2021", delay: 2000, setsField: { key: "year", value: "2021" } },
      { role: "agent", text: "Could you share the registration number?", delay: 1500 },
      { role: "user",  text: "KL 07 AB 4512", delay: 3000, setsField: { key: "reg_number", value: "KL 07 AB 4512" } },
      { role: "agent", text: "Can you describe the issue you're experiencing?", delay: 1500 },
      { role: "user",  text: "Engine making a knocking sound and check engine light is on", delay: 4000, setsField: { key: "issue", value: "Engine making a knocking sound and check engine light is on" } },
      { role: "agent", text: "Is the car currently drivable or is it a breakdown situation?", delay: 1500 },
      { role: "user",  text: "It's drivable but I'm worried", delay: 3000, setsField: { key: "urgency", value: "Normal" } },
      { role: "agent", text: "I have a slot on Monday 12th May at 9 AM with Ravi Kumar — shall I confirm that for you?", delay: 1500 },
      { role: "user",  text: "Yes please", delay: 2000, setsAppointment: SLOTS[0] },
      { role: "agent", text: "Done! You'll receive an SMS shortly. Is there anything else?", delay: 1500 },
    ];

    const timeouts = [];
    let cumulativeDelay = 0;

    conversation.forEach((msg) => {
      cumulativeDelay += msg.delay;
      const t = setTimeout(() => {
        setMessages(prev => [...prev, { ...msg, time: nowStr() }]);
        logAction(`${msg.role === "agent" ? "Agent" : "User"}: ${msg.text.substring(0, 45)}...`);
        if (msg.setsField) {
          setFieldMap(prev => ({ ...prev, [msg.setsField.key]: { value: msg.setsField.value, confirmed: true } }));
        }
        if (msg.setsAppointment) {
          setAppointment(msg.setsAppointment);
          logAction("Appointment booked");
        }
      }, cumulativeDelay);
      timeouts.push(t);
    });

    return () => timeouts.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function WorkshopDashboard({ isReal, isSummary, onEndCall, onBackToHome,
  messages, fieldMap, actionLog, appointment, smsAlert, timer, callerName }) {

  const scrollRef = useRef(null);

  useEffect(() => {
    setTimeout(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 0);
  }, [messages]);

  const FIELDS = ["owner_name", "phone", "vehicle_make", "vehicle_model", "year", "reg_number", "issue", "urgency"];
  const filledCount = FIELDS.filter(k => fieldMap[k]).length;
  const progress = Math.round((filledCount / FIELDS.length) * 100);

  return (
    <div className={`layout ${isSummary ? "summary-view" : ""}`}>

      {/* ── COL 1: TRANSCRIPT ── */}
      <div className="col">
        <div className="col-header">
          <span className="col-title">{isSummary ? "Call Summary" : isReal ? "Live Call" : "Simulation"}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--amber)" }}>{fmtTime(timer)}</span>
        </div>

        <div className="col-body" ref={scrollRef}>
          {/* Caller card */}
          <div className="call-status-bar">
            <div className="call-avatar"><User size={22} /></div>
            <div className="call-info">
              <div className="caller-name">{callerName || (isSummary ? "Archived Session" : "Connecting…")}</div>
              <div className="caller-num">LiveKit Audio Session</div>
            </div>
            <div className="call-timer">{fmtTime(timer)}</div>
          </div>

          {/* Progress bar */}
          {!isSummary && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)", marginBottom: 6 }}>
                <span>Fields collected</span>
                <span>{filledCount}/{FIELDS.length}</span>
              </div>
              <div className="meter-bar">
                <div className="meter-fill" style={{ width: `${progress}%`, background: progress === 100 ? "var(--green)" : "var(--amber)" }} />
              </div>
            </div>
          )}

          {!isSummary && (
            <div className="agent-state">
              <div className="agent-dot" />
              Aleena: Listening…
            </div>
          )}

          {/* Chat */}
          <div className="transcript-list">
            {messages.map((m, i) => (
              <div key={i} className={`msg-row ${m.role === "user" ? "msg-row--user" : "msg-row--agent"}`}>
                {m.role === "agent" && (
                  <div className="msg-avatar msg-avatar--agent"><Wrench size={13} /></div>
                )}
                <div className="msg-body">
                  <div className="msg-name">{m.role === "agent" ? "Aleena" : (callerName || "You")}</div>
                  <div className={`msg-bubble ${m.role === "user" ? "msg-bubble--user" : "msg-bubble--agent"}`}>
                    {m.text}
                  </div>
                  <div className="msg-time">{m.time}</div>
                </div>
                {m.role === "user" && (
                  <div className="msg-avatar msg-avatar--user"><User size={13} /></div>
                )}
              </div>
            ))}
            {messages.length === 0 && (
              <div className="chat-empty">
                <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
                Waiting for conversation…
              </div>
            )}
          </div>
        </div>

        <div className="controls">
          <div className="btn-row">
            {isSummary ? (
              <button className="btn btn-primary" onClick={onBackToHome}>← Back to Home</button>
            ) : (
              <button className="btn btn-danger" onClick={onEndCall}>
                <Power size={14} style={{ marginRight: 6 }} /> End Call
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── COL 2: DATA COLLECTION ── */}
      <div className="col">
        <div className="col-header">
          <span className="col-title">Collected Data</span>
          <span style={{ fontSize: 11, color: filledCount === FIELDS.length ? "var(--green)" : "var(--muted)", fontFamily: "var(--mono)" }}>
            {filledCount}/{FIELDS.length} fields
          </span>
        </div>
        <div className="col-body">
          <div className="section">
            <div className="section-label">Customer &amp; Vehicle</div>
            {FIELDS.map(key => {
              const f = fieldMap[key];
              return (
                <div key={key} className={`field ${f ? "filled" : ""}`}>
                  <div className="field-key">{key.replace(/_/g, " ")}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className={`field-val ${f ? "" : "empty"}`}>{f ? f.value : "—"}</span>
                    {f && <span className="field-badge badge-ok">✓</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {appointment && (
            <div className="section">
              <div className="section-label">Appointment</div>
              <div className="apt-card booked">
                <div className="apt-time">{appointment.time}</div>
                <div className="apt-date">{appointment.date}</div>
                <div className="apt-mechanic">🔧 {appointment.mechanic}</div>
              </div>
            </div>
          )}

          {smsAlert && (
            <div className="section">
              <div className="section-label">Urgent Alert</div>
              <div className="sms-card">
                <div className="sms-header"><span className="sms-badge">SMS Sent</span></div>
                <div className="sms-body">{smsAlert.body}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── COL 3: ACTION LOG ── */}
      <div className="col">
        <div className="col-header"><span className="col-title">Action Log</span></div>
        <div className="col-body">
          <div className="summary-card">
            <div className="action-log">
              {actionLog.map((a, i) => (
                <div key={i} className="action-item">
                  <span className="action-ts">{a.ts}</span>
                  <span>{a.text}</span>
                </div>
              ))}
              {actionLog.length === 0 && <div style={{ color: "var(--muted)" }}>Waiting for activity…</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function AutoFixWorkshop() {
  const [callMode, setCallMode] = useState("idle"); // idle | real | sim | phone | summary
  const [token, setToken] = useState(null);

  const [messages,    setMessages]    = useState([]);
  const [fieldMap,    setFieldMap]    = useState({});
  const [actionLog,   setActionLog]   = useState([]);
  const [appointment, setAppointment] = useState(null);
  const [smsAlert,    setSmsAlert]    = useState(null);
  const [isUrgent,    setIsUrgent]    = useState(false);
  const [timer,       setTimer]       = useState(0);
  const [callerName,  setCallerName]  = useState("");
  const [callHistory, setCallHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("autofix_history") || "[]"); }
    catch { return []; }
  });

  const timerRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("autofix_history", JSON.stringify(callHistory));
  }, [callHistory]);

  useEffect(() => {
    if (callMode === "real" || callMode === "sim") {
      setTimer(0);
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [callMode]);

  const logAction = useCallback((text) => {
    setActionLog(prev => [...prev, { ts: nowStr(), text }]);
  }, []);

  const fetchToken = async () => {
    try {
      console.log('Fetching token from server...');
      const identity = `user-${Math.floor(Math.random() * 9000) + 1000}`;
      const res = await fetch(`${TOKEN_SERVER_URL}?room=autofix-receptionist-room&identity=${identity}`);
      const data = await res.json();
      if (!data.token) throw new Error(data.error || "No token returned");
      console.log('Token fetched successfully');
      setToken(data.token);
      setCallMode("real");
    } catch (e) {
      console.error('Failed to fetch token:', e.message);
      alert(`Failed to connect: ${e.message}\n\nMake sure server/server.js is running on port 3001.`);
    }
  };

  const startPhoneCall = async () => {
    try {
      console.log('Starting phone call setup...');
      const res = await fetch(PHONE_CALL_URL);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start phone call");
      console.log('Phone call setup successful');
      setCallMode("phone");
    } catch (e) {
      console.error('Failed to start phone call:', e.message);
      alert(`Failed to start phone call: ${e.message}`);
    }
  };

  const endCall = useCallback(() => setCallMode("summary"), []);

  const backToHome = useCallback(() => {
    if (messages.length > 0 || Object.keys(fieldMap).length > 0) {
      const resolvedName = fieldMap.owner_name?.value || callerName || "Unknown Caller";
      setCallHistory(prev => [{
        id: Date.now(),
        ts: new Date().toLocaleString(),
        timer,
        callerName: resolvedName,
        messages:   [...messages],
        fieldMap:   { ...fieldMap },
        actionLog:  [...actionLog],
        appointment,
        smsAlert,
        summary: resolvedName,
      }, ...prev]);
    }
    // Reset state
    setMessages([]); setFieldMap({}); setActionLog([]);
    setAppointment(null); setSmsAlert(null);
    setIsUrgent(false); setTimer(0); setCallerName("");
    setCallMode("idle");
  }, [messages, fieldMap, actionLog, appointment, smsAlert, timer, callerName]);

  const viewHistory  = (item) => {
    setMessages(item.messages); setFieldMap(item.fieldMap);
    setActionLog(item.actionLog); setAppointment(item.appointment);
    setSmsAlert(item.smsAlert); setTimer(item.timer);
    setCallerName(item.callerName || "");
    setCallMode("summary");
  };

  const deleteHistory = (e, id) => {
    e.stopPropagation();
    if (confirm("Delete this call record?"))
      setCallHistory(prev => prev.filter(i => i.id !== id));
  };

  const dashboardProps = { messages, fieldMap, actionLog, appointment, smsAlert, timer, callerName, onEndCall: endCall, onBackToHome: backToHome };
  const handlerProps   = { setMessages, setFieldMap, logAction, setAppointment, setIsUrgent, setSmsAlert, setCallerName };

  // ── PHONE CALL ─────────────────────────────────────────────────────────────
  if (callMode === "phone") {
    return (
      <div className="auto-fix-workshop">
        <div className="header">
          <div className="logo">
            <div className="logo-icon"><Wrench size={20} /></div>
            <div>
              <div className="logo-text">AutoFix Workshop</div>
              <div className="logo-sub">Phone Call Mode</div>
            </div>
          </div>
        </div>

        <div className="home-container">
          <div className="home-hero">
            <h1>Phone Call Ready</h1>
            <p>The AI receptionist is waiting for your call. Dial the number below to connect.</p>
            <div style={{ textAlign: 'center', margin: '20px 0' }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                {TWILIO_NUMBER}
              </div>
              <p style={{ marginTop: '10px', color: 'var(--muted)' }}>
                Call this number to speak with Aleena, our AI receptionist.
              </p>
              <p style={{ marginTop: '5px', color: 'var(--amber)', fontSize: '0.9em' }}>
                (Only Twilio-verified phone numbers configured for the SIP trunk can successfully place calls to this number.)
              </p>
            </div>
            <div className="home-btns">
              <button className="btn btn-primary" onClick={() => setCallMode("idle")}>
                ← Back to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── IDLE / HOME ────────────────────────────────────────────────────────────
  if (callMode === "idle") {
    return (
      <div className="auto-fix-workshop">
        <div className="header">
          <div className="logo">
            <div className="logo-icon"><Wrench size={20} /></div>
            <div>
              <div className="logo-text">AutoFix Workshop</div>
              <div className="logo-sub">LiveKit AI Receptionist</div>
            </div>
          </div>
        </div>

        <div className="home-container">
          <div className="home-hero">
            <h1>Ready to repair?</h1>
            <p>Test our AI receptionist with a real voice call or simulation.</p>
            <div className="home-btns">
              <button className="btn btn-secondary btn-xl" onClick={startPhoneCall}>
                📞 Call Phone Number
              </button>
              <button className="btn btn-primary btn-xl" onClick={fetchToken}>
                <Mic size={22} style={{ marginRight: 10 }} /> Voice Call (Browser)
              </button>
              <button className="btn btn-ghost btn-xl" onClick={() => setCallMode("sim")}>
                <MessageSquare size={22} style={{ marginRight: 10 }} /> Text Simulation
              </button>
            </div>
          </div>

          {callHistory.length > 0 && (
            <div className="history-section">
              <div className="history-heading">
                <Clock size={18} />
                <h2>Recent Calls</h2>
              </div>
              <div className="history-grid">
                {callHistory.map(item => (
                  <div key={item.id} className="history-card" onClick={() => viewHistory(item)}>
                    <button className="history-del" onClick={(e) => deleteHistory(e, item.id)}>
                      <Trash2 size={13} />
                    </button>
                    <div className="history-meta">
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{item.ts}</span>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--amber)" }}>{fmtTime(item.timer)}</span>
                    </div>
                    <h3 className="history-name">{item.summary}</h3>
                    <div className="history-tags">
                      {item.fieldMap.vehicle_make && <span className="tag">{item.fieldMap.vehicle_make.value}</span>}
                      {item.fieldMap.issue         && <span className="tag blue">Issue Logged</span>}
                      {item.appointment            && <span className="tag amber">Appt Booked</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── CALL / SUMMARY VIEWS ──────────────────────────────────────────────────
  return (
    <div className="auto-fix-workshop">
      <div className="header">
        <div className="logo">
          <div className="logo-icon"><Wrench size={20} /></div>
          <div>
            <div className="logo-text">AutoFix Workshop</div>
            <div className="logo-sub">LiveKit AI Receptionist</div>
          </div>
        </div>
        <div className="badges">
          <span className="tag">{callMode === "summary" ? "Reviewing Call" : callMode === "real" ? "LiveKit Room" : "Mock Flow"}</span>
          <span className={`tag ${callMode === "summary" ? "blue" : "amber"}`}>
            {callMode === "summary" ? "Call Archived" : "AI Agent Connected"}
          </span>
        </div>
      </div>

      {callMode === "real" ? (
        <LiveKitRoom token={token} serverUrl={LIVEKIT_URL} connect audio video={false} onDisconnected={endCall}>
          <LiveKitHandler {...handlerProps} />
          <WorkshopDashboard {...dashboardProps} isReal isSummary={false} />
        </LiveKitRoom>
      ) : callMode === "summary" ? (
        <WorkshopDashboard {...dashboardProps} isReal={false} isSummary />
      ) : (
        <>
          <SimulationHandler {...handlerProps} />
          <WorkshopDashboard {...dashboardProps} isReal={false} isSummary={false} />
        </>
      )}
    </div>
  );
}