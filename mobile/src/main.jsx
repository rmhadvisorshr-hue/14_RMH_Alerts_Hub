import { Component } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'

// Shows startup/render errors on screen instead of a blank page
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    const e = this.state.error
    return e ? <pre style={{ padding: 16, whiteSpace: 'pre-wrap', color: '#b91c1c' }}>App error: {String(e.stack || e.message || e)}</pre> : this.props.children
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>)
