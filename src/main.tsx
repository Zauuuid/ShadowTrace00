import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans-arabic/arabic-200.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-300.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import './design/tokens.css';
import './design/app.css';
import './design/v5.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
