import { useState, useEffect } from "react";
import {
  FileText,
  Upload,
  Phone,
  History,
  Users,
  Search,
  Activity,
  Shield,
  Eye,
  Plus,
  X,
  CheckCircle,
  AlertCircle,
  Trash2,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Edit,
} from "lucide-react";
import "./MedicalCare.css";

// Use Vite env var `VITE_API_URL` in production/deployments. Falls back to localhost for dev.
const BASE_URL = (import.meta && import.meta.env && import.meta.env.VITE_API_URL) || "http://localhost:5001";

function fmtDuration(started, ended) {
  if (!started) return "—";
  const s = new Date(started);
  const e = ended ? new Date(ended) : new Date();
  const diff = Math.floor((e - s) / 1000);
  if (isNaN(diff) || diff < 0) return "—";
  const m = Math.floor(diff / 60);
  const sec = diff % 60;
  return `${m}m ${sec}s`;
}

function fmtDate(str) {
  if (!str) return "—";
  return str;
}

export default function MedicalCare() {
  const [view, setView] = useState("dashboard");

  const [patients, setPatients] = useState([]);
  const [calls, setCalls] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Add Patient Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: "",
    age: "",
    gender: "Male",
    phone: "",
  });

  // Edit Patient Form
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [editFormData, setEditFormData] = useState({
    name: "",
    age: "",
    gender: "",
    phone: "",
    status: "",
    history: "",
  });

  // Delete Confirmation Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);

  // Notification Modal
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationType, setNotificationType] = useState("info"); // "success", "error", "info"
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileBase64, setFileBase64] = useState("");
  const [fileType, setFileType] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");

  // Modals
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callStatus, setCallStatus] = useState("idle");
  const [callMessage, setCallMessage] = useState("");

  const fetchPatients = async () => {
    try {
      const res = await fetch(`${BASE_URL}/patients`);
      setPatients(await res.json());
    } catch (err) {
      console.error("Failed to fetch patients:", err);
    }
  };
const showNotification = (type, title, message) => {
  setNotificationType(type);
  setNotificationTitle(title);
  setNotificationMessage(message);
  setNotificationOpen(true);

  setTimeout(() => {
    setNotificationOpen(false);
  }, 3000);
};

  const fetchCalls = async () => {
    try {
      const res = await fetch(`${BASE_URL}/calls`);
      setCalls(await res.json());
    } catch (err) {
      console.error("Failed to fetch calls:", err);
    }
  };

  useEffect(() => {
    fetchPatients();
    fetchCalls();
  }, []);

  const incomingCalls = calls.filter((c) => c.call_type === "inbound");
  const outgoingCalls = calls.filter(
    (c) => c.call_type === "outbound" || !c.call_type,
  );

  const handleAddPatient = async () => {
    if (!newPatient.name || !newPatient.age || !newPatient.phone) {
      showNotification(
        "error",
        "Missing Fields",
        "Please fill all required fields",
      );
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/patient`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPatient),
      });
      if (res.ok) {
        setNewPatient({ name: "", age: "", gender: "Male", phone: "" });
        setShowAddForm(false);
        fetchPatients();
        showNotification("success", "Success", "Patient added successfully");
      } else {
        const error = await res.json();
        showNotification(
          "error",
          "Error",
          error.error || "Failed to add patient",
        );
      }
    } catch (err) {
      showNotification(
        "error",
        "Error",
        "Failed to add patient: " + err.message,
      );
    }
  };

  const handleOpenEditModal = (patient) => {
    setEditingPatient(patient);
    setEditFormData({
      name: patient.name || "",
      age: patient.age || "",
      gender: patient.gender || "",
      phone: patient.phone || "",
      status: patient.status || "Pending",
      history: patient.history || "",
    });
    setEditModalOpen(true);
  };

  const handleUpdatePatient = async () => {
    if (!editFormData.name || !editFormData.age || !editFormData.phone) {
      showNotification(
        "error",
        "Missing Fields",
        "Please fill all required fields",
      );
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/patient/${editingPatient.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editFormData),
      });
      if (res.ok) {
        setEditModalOpen(false);
        setEditingPatient(null);
        setEditFormData({
          name: "",
          age: "",
          gender: "",
          phone: "",
          status: "",
          history: "",
        });
        fetchPatients();
        showNotification("success", "Success", "Patient updated successfully");
      } else {
        const error = await res.json();
        showNotification(
          "error",
          "Error",
          error.error || "Failed to update patient",
        );
      }
    } catch (err) {
      showNotification(
        "error",
        "Error",
        "Failed to update patient: " + err.message,
      );
    }
  };

  const handleDeletePatient = async (patientId) => {
    try {
      const res = await fetch(`${BASE_URL}/patient/${patientId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        // Immediately update UI locally
        setPatients((prev) => prev.filter((p) => p.id !== patientId));

        // Refresh latest data from backend
        await fetchPatients();

        setDeleteModalOpen(false);
        setPatientToDelete(null);

        showNotification("success", "Deleted", "Patient deleted successfully");
      } else {
        const error = await res.json();

        showNotification(
          "error",
          "Error",
          error.error || "Failed to delete patient",
        );
      }
    } catch (err) {
      showNotification(
        "error",
        "Error",
        "Failed to delete patient: " + err.message,
      );
    }
  };

  const handleOpenDeleteConfirm = (patient) => {
    setPatientToDelete(patient);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (patientToDelete) {
      handleDeletePatient(patientToDelete.id);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    setFileType(file.type);
    const reader = new FileReader();
    reader.onloadend = () =>
      setFileBase64(reader.result.replace("data:", "").replace(/^.+,/, ""));
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = async () => {
    if (!selectedPatient || !fileBase64) return;
    setIsUploading(true);
    setUploadStatus("Analyzing report with AI...");
    try {
      const response = await fetch(`${BASE_URL}/analyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          file_base64: fileBase64,
          file_type: fileType,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setUploadStatus("Analysis complete! Saved to database.");
        setTimeout(() => {
          setIsUploading(false);
          setUploadSuccess(true);
          setTimeout(() => {
            setUploadSuccess(false);
            setSelectedFile(null);
            setFileBase64("");
            setView("dashboard");
            fetchPatients();
            showNotification(
              "success",
              "Success",
              "Report uploaded and analyzed successfully",
            );
          }, 2000);
        }, 1500);
      } else {
        showNotification(
          "error",
          "Error",
          data.error || "Failed to upload report",
        );
        setIsUploading(false);
      }
    } catch (err) {
      showNotification("error", "Error", "Failed to upload: " + err.message);
      setIsUploading(false);
    }
  };

  const handleTriggerCall = async (patient) => {
    setSelectedPatient(patient);
    setCallModalOpen(true);
    setCallStatus("calling");
    setCallMessage(`Connecting to ${patient.name}...`);
    try {
      const response = await fetch(`${BASE_URL}/trigger_call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patient.id }),
      });
      if (response.ok) {
        setCallStatus("success");
        setCallMessage("Call triggered successfully!");
        fetchPatients();
        fetchCalls();
      } else {
        const data = await response.json();
        setCallStatus("error");
        setCallMessage("Error: " + data.error);
      }
    } catch (err) {
      setCallStatus("error");
      setCallMessage("Failed: " + err.message);
    }
  };

  const renderMarkdown = (text) => {
    if (!text) return null;
    return text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} style={{ color: "var(--primary-med)" }}>
          {part.slice(2, -2)}
        </strong>
      ) : (
        part
      ),
    );
  };

  // ── STATUS DOT for calls ───────────────────────────────────────────────────
  const CallDot = ({ ended }) => (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ended ? "#6b7280" : "#10b981",
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );

  return (
    <div className="medical-care">
      {/* ── SIDEBAR ── */}
      <div className="med-sidebar">
        <div className="sidebar-nav">
          <button
            className={`nav-item ${view === "dashboard" ? "active" : ""}`}
            onClick={() => setView("dashboard")}
          >
            <Activity size={18} /> Dashboard
          </button>
        </div>
        <div className="sidebar-footer">
          <div className="status-badge">
            <div className="status-dot green" />
            Agent Online
          </div>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div className="med-main">
        {/* ════════════════ DASHBOARD ════════════════ */}
        {view === "dashboard" && (
          <div className="view-container">
            <div className="med-header-row">
              <h1>Patient Overview</h1>
              <div className="med-actions">
                <button
                  className="btn-med btn-primary"
                  onClick={() => setShowAddForm(!showAddForm)}
                >
                  <Plus size={16} /> Add Patient
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="stats-grid">
              <div className="stat-card">
                <Users size={20} className="stat-icon blue" />
                <div className="stat-info">
                  <div className="stat-label">Total Patients</div>
                  <div className="stat-value">{patients.length}</div>
                </div>
              </div>
              <div className="stat-card">
                <FileText size={20} className="stat-icon green" />
                <div className="stat-info">
                  <div className="stat-label">Reports Processed</div>
                  <div className="stat-value">
                    {patients.filter((p) => p.status === "Processed").length}
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <PhoneOutgoing size={20} className="stat-icon red" />
                <div className="stat-info">
                  <div className="stat-label">Outgoing Calls</div>
                  <div className="stat-value">{outgoingCalls.length}</div>
                </div>
              </div>
              <div className="stat-card">
                <PhoneIncoming size={20} className="stat-icon blue" />
                <div className="stat-info">
                  <div className="stat-label">Incoming Calls</div>
                  <div className="stat-value">{incomingCalls.length}</div>
                </div>
              </div>
            </div>

            {/* ── PATIENTS ── */}
            <div className="med-section">
              {/* ── ADD PATIENT FORM ── */}
              {showAddForm && (
                <div className="add-patient-form">
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      type="text"
                      placeholder="John Doe"
                      value={newPatient.name}
                      onChange={(e) =>
                        setNewPatient({ ...newPatient, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-group" style={{ maxWidth: 100 }}>
                    <label>Age</label>
                    <input
                      type="number"
                      placeholder="30"
                      value={newPatient.age}
                      onChange={(e) =>
                        setNewPatient({ ...newPatient, age: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-group" style={{ maxWidth: 150 }}>
                    <label>Gender</label>
                    <select
                      value={newPatient.gender}
                      onChange={(e) =>
                        setNewPatient({ ...newPatient, gender: e.target.value })
                      }
                    >
                      <option>Male</option>
                      <option>Female</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      type="text"
                      placeholder="+19129334020"
                      value={newPatient.phone}
                      onChange={(e) =>
                        setNewPatient({ ...newPatient, phone: e.target.value })
                      }
                    />
                  </div>
                  <button
                    className="btn-med btn-primary"
                    onClick={handleAddPatient}
                  >
                    Save
                  </button>
                </div>
              )}

              {/* ══════════ PATIENTS TABLE ══════════ */}
              <div
                style={{
                  marginBottom: "20px",
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                }}
              >
                <Search size={18} style={{ color: "var(--muted-med)" }} />
                <input
                  type="text"
                  placeholder="Search patients by name or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid var(--border-med)",
                    borderRadius: "8px",
                    color: "var(--text-med)",
                    fontSize: "14px",
                  }}
                />
              </div>
              <div className="patient-table">
                {patients.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "40px",
                      color: "var(--muted-med)",
                    }}
                  >
                    <Users
                      size={48}
                      style={{
                        opacity: 0.4,
                        display: "block",
                        margin: "0 auto 16px",
                      }}
                    />
                    <h3>No patients found</h3>
                    <p>Click "Add Patient" to create a new record.</p>
                  </div>
                ) : patients.filter(
                    (p) =>
                      p.name
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()) ||
                      p.phone.includes(searchQuery),
                  ).length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "40px",
                      color: "var(--muted-med)",
                    }}
                  >
                    <Users
                      size={48}
                      style={{
                        opacity: 0.4,
                        display: "block",
                        margin: "0 auto 16px",
                      }}
                    />
                    <h3>No patient found</h3>
                    <p>No results match your search query.</p>
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th className="index-col">#</th>
                        <th>Patient</th>
                        <th className="col-age-gender">Age / Gender</th>
                        <th>Phone</th>
                        <th>Condition</th>
                        <th>Status</th>
                        <th>Incoming</th>
                        <th>Outgoing</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patients
                        .filter(
                          (p) =>
                            p.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()) ||
                            p.phone.includes(searchQuery),
                        )
                        .map((p, index) => (
                          <tr key={p.id || p.phone}>
                            <td className="index-col">{index + 1}</td>
                            <td>
                              <div className="patient-cell">
                                <div></div>
                                {p.name}
                              </div>
                            </td>
                            <td className="col-age-gender">
                              {p.age} {p.gender && `(${p.gender.charAt(0)})`}
                            </td>
                            <td>{p.phone}</td>
                            <td>{p.history}</td>
                            <td>
                              <span
                                className={`status-tag ${(p.status || "pending").toLowerCase()}`}
                              >
                                {p.status || "Pending"}
                              </span>
                            </td>
                            <td style={{ fontSize: 12, fontWeight: 500 }}>
                              {
                                calls.filter(
                                  (c) =>
                                    c.call_type === "inbound" &&
                                    c.phone === p.phone,
                                ).length
                              }
                            </td>
                            <td style={{ fontSize: 12, fontWeight: 500 }}>
                              {
                                calls.filter(
                                  (c) =>
                                    c.call_type === "outbound" &&
                                    c.patient_id === p.id,
                                ).length
                              }
                            </td>
                            <td>
                              <button
                                className="icon-btn"
                                title="Upload Report"
                                onClick={() => {
                                  setSelectedPatient(p);
                                  setView("upload");
                                }}
                              >
                                <Upload size={16} />
                              </button>
                              <button
                                className="icon-btn"
                                title="View Report"
                                onClick={() => {
                                  if (!p.summary) {
                                    setCallStatus("info");
                                    setCallMessage(
                                      "No report yet. Please upload a medical document first.",
                                    );
                                    setCallModalOpen(true);
                                    return;
                                  }
                                  setSelectedPatient(p);
                                  setReportModalOpen(true);
                                }}
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                className="icon-btn"
                                title="Trigger Call"
                                onClick={() => handleTriggerCall(p)}
                              >
                                <Phone size={16} />
                              </button>
                              <button
                                className="icon-btn"
                                title="Edit Patient"
                                onClick={() => handleOpenEditModal(p)}
                              >
                                <Edit size={16} style={{ color: "#0ea5e9" }} />
                              </button>
                              <button
                                className="icon-btn"
                                title="Delete"
                                onClick={() => handleOpenDeleteConfirm(p)}
                              >
                                <Trash2
                                  size={16}
                                  style={{ color: "#ef4444" }}
                                />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════ UPLOAD VIEW ════════════════ */}
        {view === "upload" && (
          <div className="view-container centered">
            <div className="upload-box" style={{ textAlign: "left" }}>
              <button
                className="upload-close-btn"
                onClick={() => setView("dashboard")}
                title="Back"
              >
                <X size={24} />
              </button>
              <div
                className="upload-icon-wrap"
                style={{ margin: "0 auto 24px" }}
              >
                <Shield size={40} color="var(--primary-med)" />
              </div>
              <h2 style={{ textAlign: "center" }}>Upload Medical Report</h2>
              <p style={{ textAlign: "center" }}>
                {selectedPatient
                  ? `Uploading for ${selectedPatient.name} (${selectedPatient.phone})`
                  : "Please select a patient from the dashboard first."}
              </p>

              {selectedPatient && (
                <>
                  <div
                    className={`drop-zone ${isUploading ? "uploading" : ""}`}
                  >
                    {isUploading ? (
                      <div className="upload-progress">
                        <div
                          className="spinner"
                          style={{ margin: "0 auto 12px" }}
                        />
                        <span style={{ display: "block", textAlign: "center" }}>
                          {uploadStatus}
                        </span>
                      </div>
                    ) : uploadSuccess ? (
                      <div className="upload-success">
                        <div
                          className="check-circle"
                          style={{ margin: "0 auto 12px" }}
                        >
                          ✓
                        </div>
                        <span style={{ display: "block", textAlign: "center" }}>
                          Report Uploaded & Analyzed!
                        </span>
                      </div>
                    ) : (
                      <>
                        <input
                          type="file"
                          id="file-upload"
                          style={{ display: "none" }}
                          onChange={handleFileChange}
                          accept="image/*,application/pdf"
                        />
                        <label
                          htmlFor="file-upload"
                          style={{
                            cursor: "pointer",
                            width: "100%",
                            textAlign: "center",
                          }}
                        >
                          <Upload
                            size={32}
                            color="var(--muted-med)"
                            style={{ margin: "0 auto 12px" }}
                          />
                          <p style={{ margin: "0 0 8px" }}>
                            {selectedFile
                              ? selectedFile.name
                              : "Click to select medical report"}
                          </p>
                          <span
                            className="file-hint"
                            style={{ display: "block", marginBottom: 4 }}
                          >
                            Supported: JPG, PNG, PDF
                          </span>
                          <span className="file-hint">
                            Secure HIPAA compliant processing
                          </span>
                        </label>
                      </>
                    )}
                  </div>
                  {!isUploading && !uploadSuccess && (
                    <button
                      className="btn-med btn-primary"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        marginTop: 16,
                      }}
                      onClick={handleUploadSubmit}
                      disabled={!selectedFile}
                    >
                      Analyze Report
                    </button>
                  )}
                </>
              )}

              {!selectedPatient && (
                <button
                  className="btn-med btn-secondary"
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    marginTop: 16,
                  }}
                  onClick={() => setView("dashboard")}
                >
                  Go to Dashboard
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── REPORT MODAL ── */}
      {reportModalOpen && selectedPatient && (
        <div
          className="modal-overlay"
          onClick={() => setReportModalOpen(false)}
        >
          <div
            className="modal-content wide"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setReportModalOpen(false)}
            >
              <X size={20} />
            </button>
            <h2 style={{ marginBottom: 20 }}>
              Analysis Report: {selectedPatient.name}
            </h2>
            <div className="report-split">
              <div className="report-pane">
                <h3>Original Document</h3>
                {selectedPatient.file_type?.startsWith("image/") ? (
                  <img
                    src={`data:${selectedPatient.file_type};base64,${selectedPatient.file_base64}`}
                    alt="Report"
                  />
                ) : selectedPatient.file_type === "application/pdf" ? (
                  <iframe
                    src={`data:application/pdf;base64,${selectedPatient.file_base64}`}
                    title="PDF"
                  />
                ) : (
                  <div className="empty-state" style={{ padding: "40px 0" }}>
                    <FileText size={48} color="var(--muted-med)" />
                    <p style={{ marginTop: 16 }}>No document preview.</p>
                  </div>
                )}
              </div>
              <div className="report-pane">
                <h3>AI Analysis Summary</h3>
                <div
                  style={{
                    lineHeight: 1.6,
                    color: "var(--text-med)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {renderMarkdown(selectedPatient.summary)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CALL MODAL ── */}
      {callModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => callStatus !== "calling" && setCallModalOpen(false)}
        >
          <div
            className="modal-content call-popup"
            onClick={(e) => e.stopPropagation()}
          >
            {callStatus === "calling" && (
              <>
                <div className="spinner" style={{ margin: "0 auto 24px" }} />
                <h2>Triggering Call...</h2>
                <p>{callMessage}</p>
              </>
            )}
            {callStatus === "success" && (
              <>
                <CheckCircle
                  size={48}
                  color="#10b981"
                  style={{ margin: "0 auto 24px" }}
                />
                <h2>Call Triggered</h2>
                <p>{callMessage}</p>
                <button
                  className="btn-med btn-primary"
                  style={{ margin: "0 auto" }}
                  onClick={() => setCallModalOpen(false)}
                >
                  Close
                </button>
              </>
            )}
            {callStatus === "error" && (
              <>
                <AlertCircle
                  size={48}
                  color="#ef4444"
                  style={{ margin: "0 auto 24px" }}
                />
                <h2>Failed to Call</h2>
                <p>{callMessage}</p>
                <button
                  className="btn-med btn-secondary"
                  style={{ margin: "0 auto" }}
                  onClick={() => setCallModalOpen(false)}
                >
                  Close
                </button>
              </>
            )}
            {callStatus === "info" && (
              <>
                <FileText
                  size={48}
                  color="var(--primary-med)"
                  style={{ margin: "0 auto 24px" }}
                />
                <h2>Action Required</h2>
                <p>{callMessage}</p>
                <button
                  className="btn-med btn-primary"
                  style={{ margin: "0 auto" }}
                  onClick={() => setCallModalOpen(false)}
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── EDIT PATIENT MODAL ── */}
      {editModalOpen && editingPatient && (
        <div className="modal-overlay" onClick={() => setEditModalOpen(false)}>
          <div
            className="edit-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="edit-modal-header">
              <h2>Edit Patient: {editingPatient.name}</h2>
              <button
                className="edit-modal-close"
                onClick={() => setEditModalOpen(false)}
              >
                <X size={24} />
              </button>
            </div>

            <div className="edit-modal-body">
              <div className="edit-form-row">
                <div className="edit-form-group">
                  <label className="edit-form-label">Name</label>
                  <input
                    type="text"
                    className="edit-form-input"
                    placeholder="Patient name"
                    value={editFormData.name}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, name: e.target.value })
                    }
                  />
                </div>
                <div className="edit-form-group">
                  <label className="edit-form-label">Age</label>
                  <input
                    type="number"
                    className="edit-form-input"
                    placeholder="Age"
                    value={editFormData.age}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, age: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="edit-form-row">
                <div className="edit-form-group">
                  <label className="edit-form-label">Gender</label>
                  <select
                    className="edit-form-select"
                    value={editFormData.gender}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        gender: e.target.value,
                      })
                    }
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="edit-form-group">
                  <label className="edit-form-label">Status</label>
                  <select
                    className="edit-form-select"
                    value={editFormData.status}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        status: e.target.value,
                      })
                    }
                  >
                    <option>Pending</option>
                    <option>Active</option>
                    <option>Inactive</option>
                    <option>Reviewed</option>
                  </select>
                </div>
              </div>

              <div className="edit-form-group edit-form-row full">
                <label className="edit-form-label">Phone</label>
                <input
                  type="text"
                  className="edit-form-input"
                  placeholder="Phone number"
                  value={editFormData.phone}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, phone: e.target.value })
                  }
                />
              </div>

              <div className="edit-form-group edit-form-row full">
                <label className="edit-form-label">Medical History</label>
                <input
                  type="text"
                  className="edit-form-input"
                  placeholder="Medical history"
                  value={editFormData.history}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      history: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="edit-modal-footer">
              <button
                className="edit-modal-btn edit-modal-btn-cancel"
                onClick={() => setEditModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="edit-modal-btn edit-modal-btn-submit"
                onClick={handleUpdatePatient}
              >
                Update Patient
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      {deleteModalOpen && patientToDelete && (
        <div
          className="delete-modal-overlay"
          onClick={() => setDeleteModalOpen(false)}
        >
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="delete-modal-icon">
              <AlertCircle size={56} />
            </div>
            <div className="delete-modal-body">
              <h3 className="delete-modal-title">Delete Patient?</h3>
              <p className="delete-modal-message">
                Are you sure you want to delete{" "}
                <strong>{patientToDelete.name}</strong>? This action cannot be
                undone.
              </p>
            </div>
            <div className="delete-modal-footer">
              <button
                className="delete-modal-btn delete-modal-btn-cancel"
                onClick={() => setDeleteModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="delete-modal-btn delete-modal-btn-confirm"
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── NOTIFICATION MODAL ── */}
      {notificationOpen && (
        <div className={`toast-notification ${notificationType}`}>
          <div className="toast-icon">
            {notificationType === "success" && <CheckCircle size={20} />}

            {notificationType === "error" && <AlertCircle size={20} />}

            {notificationType === "info" && <FileText size={20} />}
          </div>

          <div className="toast-content">
            <h4>{notificationTitle}</h4>
            <p>{notificationMessage}</p>
          </div>

          <button
            className="toast-close"
            onClick={() => setNotificationOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
