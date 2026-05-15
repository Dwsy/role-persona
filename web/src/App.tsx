import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Memory from './pages/Memory'
import Knowledge from './pages/Knowledge'
import Roles from './pages/Roles'
import Settings from './pages/Settings'
import ActivityPage from './pages/Activity'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/activity" element={<ActivityPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
