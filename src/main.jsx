import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Import test function for development
import '@/api/testPerformanceSnapshot.js'
import '@/api/debugSnapshot.js'
import '@/api/testQueueCall.js'

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
) 