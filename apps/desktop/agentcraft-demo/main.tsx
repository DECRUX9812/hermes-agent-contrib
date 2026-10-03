import '../src/plugins/agentcraft/agentcraft.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { StudioPage } from '../src/plugins/agentcraft/studio-page'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ position: 'fixed', inset: 0 }}>
      <StudioPage />
    </div>
  </StrictMode>,
)
