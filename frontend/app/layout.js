import './globals.css';

export const metadata = {
  title: 'ByteBot Player',
  description: 'Music control center for ByteBot',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
