import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import './design.css';
import './theme.css';
import './Theme';

const AdminApp = lazy(() => import('./admin/AdminApp'));

const pathname = window.location.pathname;
const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdminRoute
      ? <Suspense fallback={<main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><span className="spinner" /></main>}><AdminApp /></Suspense>
      : <App />}
  </React.StrictMode>,
);
