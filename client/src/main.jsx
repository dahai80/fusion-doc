import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { isEmbedded, shellBasePath } from './lib/embedded';
import { initShellSync } from './lib/shell-bridge';
import './styles/globals.css';

// issue #51: when embedded in the shell, mount under the /shell/<id>/ subpath and align the router basename
const routerBasename = isEmbedded ? shellBasePath() : '/';

// issue #58: when embedded, listen for host theme/lang events and sync the initial state
initShellSync();

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter basename={routerBasename}>
            <App />
        </BrowserRouter>
    </React.StrictMode>
);
