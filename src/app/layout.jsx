import './globals.css';
import { ToastProvider } from '@/components/ui';

export const metadata = { title: 'GENIQ Travel Management', description: 'Corporate travel, expense and reimbursement platform' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
