import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import './app/themes/base.css'
import './app/themes/forest.css'
import './app/themes/violet.css'
import './app/themes/ocean.css'
import './app/themes/amber.css'
import './app/themes/rose.css'
import './app/styles.css'
import './app/workspace.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
