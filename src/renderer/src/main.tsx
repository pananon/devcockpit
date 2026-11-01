import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { App } from './App';
import { Pill } from './components/Pill';

const isPill = location.hash === '#pill';
if (isPill) document.documentElement.classList.add('pill-window');

createRoot(document.getElementById('root')!).render(<StrictMode>{isPill ? <Pill /> : <App />}</StrictMode>);
