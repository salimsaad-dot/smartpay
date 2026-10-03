import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata = {
  title: "SmartPay",
  description: "School fee collection, payment, and arrears-SMS reminder platform",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--ink)] antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
