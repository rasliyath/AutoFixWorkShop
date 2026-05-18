import { useState, useEffect } from "react";
import { LayoutGrid, Wrench, Hospital, ChevronDown, Check } from "lucide-react";
import "./TenantSwitcher.css";

const TENANTS = [
  // { id: "workshop", name: "AutoFix Workshop", icon: Wrench, color: "var(--amber)", sub: "Automotive Care" },
  { id: "medical", name: "Medical Care", icon: Hospital, color: "#ef4444", sub: "Healthcare Services" },
];

export default function TenantSwitcher({ activeTenant, onSwitch }) {
  const [isOpen, setIsOpen] = useState(false);
  const current = TENANTS.find(t => t.id === activeTenant) || TENANTS[0];

  useEffect(() => {
    if (activeTenant !== "medical") {
      onSwitch("medical");
    }
  }, [activeTenant, onSwitch]);

  return (
    <div className="tenant-switcher-container">
      <button 
        className="tenant-trigger" 
        onClick={() => setIsOpen(!isOpen)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
      >
        <div className="tenant-icon-wrap" style={{ background: current.color }}>
          <current.icon size={18} color="white" />
        </div>
        <div className="tenant-label">
          <div className="tenant-name">{current.name}</div>
          <div className="tenant-sub">{current.sub}</div>
        </div>
        <ChevronDown size={14} className={`chevron ${isOpen ? "open" : ""}`} />
      </button>

      {/* {isOpen && (
        <div className="tenant-menu">
          <div className="menu-header">Select Workspace</div>
          {TENANTS.map(t => (
            <button
              key={t.id}
              className={`menu-item ${t.id === activeTenant ? "active" : ""}`}
              onClick={() => {
                onSwitch(t.id);
                setIsOpen(false);
              }}
            >
              <div className="menu-icon" style={{ background: t.color }}>
                <t.icon size={16} color="white" />
              </div>
              <div className="menu-text">
                <div className="menu-name">{t.name}</div>
                <div className="menu-sub">{t.sub}</div>
              </div>
              {t.id === activeTenant && <Check size={14} className="check-icon" />}
            </button>
          ))}
        </div>
      )} */}
    </div>
  );
}
