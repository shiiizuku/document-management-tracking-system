import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Document Tracking System',
  description: 'Secure document registration, routing, and accountability.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
