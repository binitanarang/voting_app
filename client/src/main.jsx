import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { COMPETITION } from './api.js';
import App from './App.jsx';
import CompetitionPicker from './CompetitionPicker.jsx';
import './styles/mara.css';
import './styles/app.css';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {COMPETITION ? (
      <BrowserRouter basename={`/${COMPETITION}`}>
        <App />
      </BrowserRouter>
    ) : (
      <CompetitionPicker />
    )}
  </React.StrictMode>
);
