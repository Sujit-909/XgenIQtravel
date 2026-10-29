import './globals.css';
import TooltipLayer from '@/components/TooltipLayer';
import { ToastProvider } from '@/components/ui';

export const metadata = { title: 'GENIQ Travel Management', description: 'Corporate travel, expense and reimbursement platform' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><ToastProvider>{children}<TooltipLayer /></ToastProvider></body>
    </html>
  );
}
