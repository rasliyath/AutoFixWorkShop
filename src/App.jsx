import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import AutoFixWorkshop from './components/AutoFixWorkshop'
import MedicalCare from './components/MedicalCare'
import TenantSwitcher from './components/TenantSwitcher'
import LandingPage from './components/LandingPage'
import { Home } from 'lucide-react'
import './App.css'

function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Determine active tenant from path
  const activeTenant = location.pathname === '/workshop' ? 'workshop' : 
                       location.pathname === '/medical' ? 'medical' : null;

  // Don't show header on landing page
  if (location.pathname === '/') {
    return <>{children}</>;
  }

  return (
    <div className="App">
      <header className="global-header">
        <div className="global-header-content">
          <div className="header-left">
            <button className="home-btn" onClick={() => navigate('/')} title="Back to Landing Page">
              <Home size={18} />
            </button>
            {/* <TenantSwitcher activeTenant={activeTenant} onSwitch={(id) => navigate(`/${id}`)} /> */}
          </div>
          <div className="global-nav-info">
            <span className="env-badge">Production Environment</span>
          </div>
        </div>
      </header>
      <main className="app-content">
        {children}
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          {/* <Route path="/" element={<LandingPage />} /> */}
          <Route path="/" element={<MedicalCare />} />
          {/* <Route path="/workshop" element={<AutoFixWorkshop />} /> */}
       
        </Routes>
      </Layout>
    </Router>
  )
}

export default App
