import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ReactionParticlesProvider } from './ReactionParticlesManager';
import './css/index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ReactionParticlesProvider>
      <App />
    </ReactionParticlesProvider>
  </React.StrictMode>
);
