import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { isEmbedded, shellBasePath } from './lib/embedded';
import './styles/globals.css';

// issue #51: shell 内嵌时挂载于 /shell/<id>/ 子路径, router basename 对齐
const routerBasename = isEmbedded ? shellBasePath() : '/';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter basename={routerBasename}>
            <App />
        </BrowserRouter>
    </React.StrictMode>
);
