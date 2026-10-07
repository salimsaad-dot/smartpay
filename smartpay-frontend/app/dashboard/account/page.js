"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  Field,
  PageHeader,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";

// The only account-recovery surface this product has — one school_admin
// per school, no password-change endpoint existed before this page's
// backend was built, meaning a leaked credential had no way to be shut
// out short of waiting out a 24-hour token. Change Password closes that
// gap for the normal case; Log Out Everywhere is the faster kill-switch
// for "I think my session or device is compromised right now."
function ChangePasswordForm({ showToast }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password changed. Any other signed-in devices have been logged out.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <h2 className="font-semibold text-[var(--ink)]">Change Password</h2>
      <p className="text-sm text-[var(--slate-quiet)]">Changing your password automatically signs out every other device using this account.</p>
      <Field label="Current Password">
        <input
          type="password" required autoComplete="current-password"
          value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="New Password">
        <input
          type="password" required minLength={8} autoComplete="new-password"
          value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Confirm New Password">
        <input
          type="password" required minLength={8} autoComplete="new-password"
          value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </Field>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? "Changing..." : "Change Password"}</Button>
    </form>
  );
}

function RevokeSessionsPanel() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");

  async function handleRevoke() {
    setRevoking(true);
    setError("");
    try {
      await apiRequest("/auth/revoke-sessions", { method: "POST" });
      // This also logs the current device out — a full page navigation to
      // /login (not just router.push) so AuthContext doesn't hold onto a
      // now-stale "logged in" state from before the revoke.
      window.location.href = "/login";
    } catch (err) {
      setError(err.message);
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <h2 className="font-semibold text-[var(--ink)]">Log Out Everywhere</h2>
      <p className="text-sm text-[var(--slate-quiet)]">
        Immediately ends every signed-in session for this account, including this one — use this if a device
        might be compromised. You'll need to log in again afterward.
      </p>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {!confirming ? (
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>Log Out Everywhere</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={handleRevoke} disabled={revoking}>
            {revoking ? "Logging out..." : "Yes, log out everywhere"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={revoking}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

export default function AccountPage() {
  const { user } = useAuth();
  const { toast, showToast, dismissToast } = useToast();

  return (
    <DashboardShell>
      <PageHeader title="Account & Security" description={user ? `Signed in as ${user.email}` : undefined} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChangePasswordForm showToast={showToast} />
        <RevokeSessionsPanel />
      </div>

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
