import Sidebar from "@/components/Sidebar";
import { AuthProvider } from "@/lib/auth-context";
import PasswordChangeGate from "@/components/PasswordChangeGate";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-slate-50 p-8">
          <PasswordChangeGate>{children}</PasswordChangeGate>
        </main>
      </div>
    </AuthProvider>
  );
}
