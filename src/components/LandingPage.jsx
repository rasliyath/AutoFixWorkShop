import { Wrench, Hospital, ArrowRight, ShieldCheck, Cpu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

const TENANTS = [
  { 
    id: "workshop", 
    name: "AutoFix Workshop", 
    icon: Wrench, 
    color: "#f59e0b",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    sub: "Automotive Care & AI Receptionist",
    description: "Intelligent booking and customer support for modern workshops.",
    features: ["LiveKit Voice AI","Appointment Booking"]
  },
  { 
    id: "medical", 
    name: "Medical Care", 
    icon: Hospital, 
    color: "#0ea5e9",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
    sub: "Healthcare Services & Patient Briefing",
    description: "Streamlined medical history processing and patient communication.",
    features: ["HIPAA Compliant", "Report Analysis", "AI Briefing Calls"]
  },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landing-page">
      <div className="landing-bg">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
      </div>

      <div className="landing-content">
        <div className="landing-header">
          <div className="platform-tag">
            <Cpu size={14} />
            AI Multi-Tenant Platform
          </div>
          <h1>Select Your Workspace</h1>
          <p className="platform-tag">Choose an industry-specific AI module to begin managing your operations.</p>
        </div>

        <div className="tenant-cards">
          {TENANTS.map((tenant) => (
            <div key={tenant.id} className="tenant-card" onClick={() => navigate(`/${tenant.id}`)}>
              <div className="card-inner">
                <div className="card-top">
                  <div className="tenant-icon-lg" style={{ background: tenant.gradient }}>
                    <tenant.icon size={32} color="white" />
                  </div>
                  <div className="tenant-info">
                    <span className="tenant-sub-tag">{tenant.sub}</span>
                    <h2>{tenant.name}</h2>
                  </div>
                </div>
                
                <p className="tenant-desc">{tenant.description}</p>
                
                <div className="tenant-features">
                  {tenant.features.map(f => (
                    <div key={f} className="feature-pill">
                      <ShieldCheck size={12} />
                      {f}
                    </div>
                  ))}
                </div>

                <div className="card-footer">
                  <span className="launch-text">Launch Module</span>
                  <div className="arrow-wrap">
                    <ArrowRight size={18} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="landing-footer">
          <p>© 2026 AI Enterprise Solutions. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
