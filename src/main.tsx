import { AccessGate } from './partner/AccessGate'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PartnerBoard from './partner/App'
import './styles.css'

const url = new URL(location.href)
url.searchParams.delete('view')
history.replaceState(null, '', url)
createRoot(document.getElementById('root')!).render(<StrictMode><AccessGate><PartnerBoard /></AccessGate></StrictMode>)
